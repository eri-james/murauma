/**
 * Public API — Racer Leaderboard (DB-driven, replaces hardcoded SEASONS constant)
 *
 * GET /api/race-leaderboard — Aggregated racer rankings by performance
 *
 * Query parameters:
 *   ?category=graded   — Division filter (default: 'graded'). One of: open, graded.
 *   ?season=2026s1     — Season id (optional, defaults to active main season)
 *   ?leaderboardId=N   — Explicit leaderboard id (overrides season+category)
 *   ?allTime=true       — Skip season filter (aggregates across ALL seasons)
 *
 * Scoring: 1st=10, 2nd=6, 3rd=4, 4th=2, 5th+=1
 * Tiebreaker: most 1sts → most 2nds → most 3rds → fewest races
 *
 * Behavior:
 *   - For archived seasons: returns the immutable snapshot from
 *     season_archive_snapshots (live aggregation is bypassed)
 *   - For non-archived seasons: live aggregation via race_leaderboard_bindings
 *   - Fallback: if a season has no race_leaderboard_bindings rows (legacy
 *     data), falls back to the original date-based filter using season.start_date
 *   - All-Time: aggregates across all races with results, no season filter
 */
import {
  errorResponse,
  successResponse,
} from '../_shared/utils.js';

const VALID_CATEGORIES = ['open', 'graded'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const category = (url.searchParams.get('category') || 'graded').toLowerCase();
    const allTime = url.searchParams.get('allTime') === 'true';
    const seasonIdParam = url.searchParams.get('season');
    const leaderboardIdParam = url.searchParams.get('leaderboardId');

    if (!VALID_CATEGORIES.includes(category)) {
      return errorResponse('Category must be "open" or "graded".');
    }

    // ---- Resolve the target leaderboard ----
    let targetLb = null;
    let targetSeason = null;

    if (leaderboardIdParam) {
      // Explicit leaderboard ID — fetch it directly
      const lbId = parseInt(leaderboardIdParam, 10);
      if (!lbId || isNaN(lbId)) {
        return errorResponse('leaderboardId must be a valid integer.');
      }
      targetLb = await db
        .prepare(
          `SELECT lb.id, lb.season_id, lb.division, lb.display_name,
                  s.label AS season_label, s.kind AS season_kind,
                  s.start_date AS season_start, s.end_date AS season_end,
                  s.status AS season_status, s.is_pickem_active, s.archived_at
           FROM leaderboards lb
           JOIN seasons s ON s.id = lb.season_id
           WHERE lb.id = ?`
        )
        .bind(lbId)
        .first();
      if (!targetLb) {
        return errorResponse(`Leaderboard #${lbId} not found.`, 404);
      }
      if (targetLb.division !== category) {
        return errorResponse(`Leaderboard #${lbId} is for division "${targetLb.division}", but you requested category "${category}".`, 400);
      }
      targetSeason = {
        id: targetLb.season_id,
        label: targetLb.season_label,
        kind: targetLb.season_kind,
        startDate: targetLb.season_start,
        endDate: targetLb.season_end,
        status: targetLb.season_status,
        isPickemActive: targetLb.is_pickem_active === 1,
        archivedAt: targetLb.archived_at,
      };
    } else if (!allTime) {
      // Resolve by season param (or default to active main season)
      let resolvedSeasonId = seasonIdParam;
      if (!resolvedSeasonId) {
        const activeMain = await db
          .prepare(`SELECT id FROM seasons WHERE kind = 'main' AND status = 'active' LIMIT 1`)
          .first();
        if (!activeMain) {
          // No active season — return empty
          return successResponse('No active season found.', {
            season: null,
            category,
            leaderboard: [],
          });
        }
        resolvedSeasonId = activeMain.id;
      }

      targetSeason = await db
        .prepare(
          `SELECT id, label, kind, start_date, end_date, status, is_pickem_active, archived_at
           FROM seasons WHERE id = ?`
        )
        .bind(resolvedSeasonId)
        .first();
      if (!targetSeason) {
        return errorResponse(`Season "${resolvedSeasonId}" not found.`, 404);
      }

      // Fetch the leaderboard for this season + category
      targetLb = await db
        .prepare(`SELECT id, division, display_name FROM leaderboards WHERE season_id = ? AND division = ?`)
        .bind(resolvedSeasonId, category)
        .first();
      // If no leaderboard row exists for this division, we still proceed —
      // the fallback path uses season.start_date for the date-based filter.
    }

    // ---- For archived seasons, return the immutable snapshot ----
    if (targetSeason && targetSeason.status === 'archived') {
      const snapshot = await db
        .prepare(`SELECT snapshot_json, snapshot_taken_at
                  FROM season_archive_snapshots
                  WHERE season_id = ? AND division = ? AND is_locked = 1
                  LIMIT 1`)
        .bind(targetSeason.id, category)
        .first();

      if (!snapshot) {
        return successResponse('No archived snapshot for this season/division.', {
          season: {
            id: targetSeason.id,
            label: targetSeason.label,
            startDate: targetSeason.startDate,
            endDate: targetSeason.endDate,
            status: targetSeason.status,
            archivedAt: targetSeason.archivedAt,
            raceCount: 0,
            isSnapshot: true,
          },
          category,
          leaderboard: [],
        });
      }

      const parsed = JSON.parse(snapshot.snapshot_json);
      return successResponse('Leaderboard loaded from archived snapshot.', {
        season: {
          id: targetSeason.id,
          label: targetSeason.label,
          startDate: targetSeason.startDate,
          endDate: targetSeason.endDate,
          status: targetSeason.status,
          archivedAt: targetSeason.archivedAt,
          raceCount: parsed.raceCount || 0,
          isSnapshot: true,
          snapshotTakenAt: snapshot.snapshot_taken_at,
        },
        category,
        leaderboard: parsed.leaderboard || [],
      });
    }

    // ---- Live aggregation ----
    // Two paths:
    //   A) If we have a targetLb.id, use race_leaderboard_bindings (preferred)
    //   B) Else (no leaderboard row, e.g., legacy season) fall back to date filter
    let raceCount = 0;
    let leaderboard = [];

    const useBindings = targetLb && targetLb.id;

    if (useBindings) {
      // Count races bound to this leaderboard with results
      const raceCountResult = await db
        .prepare(
          `SELECT COUNT(DISTINCT rp.race_id) AS race_count
           FROM race_participants rp
           JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
           WHERE rp.position IS NOT NULL
             AND rlb.leaderboard_id = ?
             AND rp.category = ?`
        )
        .bind(targetLb.id, category)
        .first();
      raceCount = raceCountResult?.race_count || 0;

      if (raceCount > 0) {
        const { results } = await db
          .prepare(
            `SELECT
                rp.member_id,
                m.name AS member_name,
                m.trainer_id,
                COUNT(*) AS total_races,
                SUM(CASE WHEN rp.position = 1 THEN 10
                         WHEN rp.position = 2 THEN 6
                         WHEN rp.position = 3 THEN 4
                         WHEN rp.position = 4 THEN 2
                         ELSE 1 END) AS total_points,
                SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN rp.position = 2 THEN 1 ELSE 0 END) AS seconds,
                SUM(CASE WHEN rp.position = 3 THEN 1 ELSE 0 END) AS thirds,
                SUM(CASE WHEN rp.position <= 3 THEN 1 ELSE 0 END) AS podiums,
                ROUND(AVG(CAST(rp.position AS REAL)), 2) AS avg_position
             FROM race_participants rp
             JOIN members m ON m.id = rp.member_id
             JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
             WHERE rp.position IS NOT NULL
               AND rlb.leaderboard_id = ?
               AND rp.category = ?
             GROUP BY rp.member_id
             ORDER BY total_points DESC, wins DESC, seconds DESC, thirds DESC, total_races ASC`
          )
          .bind(targetLb.id, category)
          .all();
        leaderboard = results;
      }
    } else if (targetSeason) {
      // Fallback: date-based filter on season.start_date (legacy behavior)
      const seasonStart = targetSeason.startDate || '1970-01-01';

      const raceCountResult = await db
        .prepare(
          `SELECT COUNT(DISTINCT rp.race_id) AS race_count
           FROM race_participants rp
           JOIN weekly_races wr ON wr.id = rp.race_id
           WHERE rp.position IS NOT NULL
             AND rp.category = ?
             AND wr.created_at >= ?`
        )
        .bind(category, seasonStart)
        .first();
      raceCount = raceCountResult?.race_count || 0;

      if (raceCount > 0) {
        const { results } = await db
          .prepare(
            `SELECT
                rp.member_id,
                m.name AS member_name,
                m.trainer_id,
                COUNT(*) AS total_races,
                SUM(CASE WHEN rp.position = 1 THEN 10
                         WHEN rp.position = 2 THEN 6
                         WHEN rp.position = 3 THEN 4
                         WHEN rp.position = 4 THEN 2
                         ELSE 1 END) AS total_points,
                SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN rp.position = 2 THEN 1 ELSE 0 END) AS seconds,
                SUM(CASE WHEN rp.position = 3 THEN 1 ELSE 0 END) AS thirds,
                SUM(CASE WHEN rp.position <= 3 THEN 1 ELSE 0 END) AS podiums,
                ROUND(AVG(CAST(rp.position AS REAL)), 2) AS avg_position
             FROM race_participants rp
             JOIN members m ON m.id = rp.member_id
             JOIN weekly_races wr ON wr.id = rp.race_id
             WHERE rp.position IS NOT NULL
               AND rp.category = ?
               AND wr.created_at >= ?
             GROUP BY rp.member_id
             ORDER BY total_points DESC, wins DESC, seconds DESC, thirds DESC, total_races ASC`
          )
          .bind(category, seasonStart)
          .all();
        leaderboard = results;
      }
    } else if (allTime) {
      // All-time aggregation — no season filter at all
      const raceCountResult = await db
        .prepare(
          `SELECT COUNT(DISTINCT rp.race_id) AS race_count
           FROM race_participants rp
           WHERE rp.position IS NOT NULL
             AND rp.category = ?`
        )
        .bind(category)
        .first();
      raceCount = raceCountResult?.race_count || 0;

      if (raceCount > 0) {
        const { results } = await db
          .prepare(
            `SELECT
                rp.member_id,
                m.name AS member_name,
                m.trainer_id,
                COUNT(*) AS total_races,
                SUM(CASE WHEN rp.position = 1 THEN 10
                         WHEN rp.position = 2 THEN 6
                         WHEN rp.position = 3 THEN 4
                         WHEN rp.position = 4 THEN 2
                         ELSE 1 END) AS total_points,
                SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN rp.position = 2 THEN 1 ELSE 0 END) AS seconds,
                SUM(CASE WHEN rp.position = 3 THEN 1 ELSE 0 END) AS thirds,
                SUM(CASE WHEN rp.position <= 3 THEN 1 ELSE 0 END) AS podiums,
                ROUND(AVG(CAST(rp.position AS REAL)), 2) AS avg_position
             FROM race_participants rp
             JOIN members m ON m.id = rp.member_id
             WHERE rp.position IS NOT NULL
               AND rp.category = ?
             GROUP BY rp.member_id
             ORDER BY total_points DESC, wins DESC, seconds DESC, thirds DESC, total_races ASC`
          )
          .bind(category)
          .all();
        leaderboard = results;
      }
    }

    // Shape leaderboard rows
    const shapedLeaderboard = leaderboard.map((row, index) => ({
      rank: index + 1,
      memberId: row.member_id,
      memberName: row.member_name,
      trainerId: row.trainer_id,
      avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.member_id}`,
      totalPoints: row.total_points,
      wins: row.wins,
      seconds: row.seconds,
      thirds: row.thirds,
      podiums: row.podiums,
      totalRaces: row.total_races,
      avgPosition: row.avg_position,
    }));

    // For each ranked member, also fetch their presence in the OTHER division
    // (shown in inline detail as "also has X entries in [other]")
    const otherCategory = category === 'graded' ? 'open' : 'graded';
    if (shapedLeaderboard.length > 0) {
      const memberIds = shapedLeaderboard.map(l => l.memberId);
      const placeholders = memberIds.map(() => '?').join(',');

      // Try bindings-aware query first (if we have targetLb.id), else fall back to dates
      let otherResults;
      if (targetLb && targetLb.id) {
        // Find the OTHER division's leaderboard for this same season
        const otherLb = await db
          .prepare(`SELECT id FROM leaderboards WHERE season_id = ? AND division = ?`)
          .bind(targetSeason.id, otherCategory)
          .first();
        if (otherLb) {
          otherResults = await db
            .prepare(
              `SELECT rp.member_id, COUNT(*) AS other_races,
                      SUM(CASE WHEN rp.position = 1 THEN 10
                               WHEN rp.position = 2 THEN 6
                               WHEN rp.position = 3 THEN 4
                               WHEN rp.position = 4 THEN 2
                               ELSE 1 END) AS other_points
               FROM race_participants rp
               JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
               WHERE rp.position IS NOT NULL
                 AND rlb.leaderboard_id = ?
                 AND rp.category = ?
                 AND rp.member_id IN (${placeholders})
               GROUP BY rp.member_id`
            )
            .bind(otherLb.id, otherCategory, ...memberIds)
            .all();
        }
      }
      if (!otherResults && targetSeason) {
        // Fallback: date-based query
        const seasonStart = targetSeason.startDate || '1970-01-01';
        otherResults = await db
          .prepare(
            `SELECT rp.member_id, COUNT(*) AS other_races,
                    SUM(CASE WHEN rp.position = 1 THEN 10
                             WHEN rp.position = 2 THEN 6
                             WHEN rp.position = 3 THEN 4
                             WHEN rp.position = 4 THEN 2
                             ELSE 1 END) AS other_points
             FROM race_participants rp
             JOIN weekly_races wr ON wr.id = rp.race_id
             WHERE rp.position IS NOT NULL
               AND rp.category = ?
               AND wr.created_at >= ?
               AND rp.member_id IN (${placeholders})
             GROUP BY rp.member_id`
          )
          .bind(otherCategory, seasonStart, ...memberIds)
          .all();
      }

      if (otherResults) {
        const otherMap = {};
        for (const row of otherResults.results) {
          otherMap[row.member_id] = {
            category: otherCategory,
            totalRaces: row.other_races,
            totalPoints: row.other_points,
          };
        }
        for (const entry of shapedLeaderboard) {
          entry.otherDivision = otherMap[entry.memberId] || null;
        }
      }
    }

    return successResponse('Leaderboard loaded.', {
      season: targetSeason ? {
        id: targetSeason.id,
        label: targetSeason.label,
        kind: targetSeason.kind,
        startDate: targetSeason.startDate,
        endDate: targetSeason.endDate,
        status: targetSeason.status,
        raceCount,
      } : null,
      category,
      leaderboard: shapedLeaderboard,
    });
  } catch (error) {
    console.error('Racer leaderboard GET error:', error.message, error.stack);
    return errorResponse(`Failed to load leaderboard: ${error.message}`, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
