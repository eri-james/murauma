/**
 * Public API — Race Predictions Leaderboard (DB-driven)
 *
 * GET /api/race-predictions/leaderboard
 *   Optional: ?season=<id>     — Season to filter (defaults to active main season)
 *   Optional: ?leaderboardId=N  — Explicit pickem leaderboard ID
 *   Optional: ?allTime=true     — Skip season filter
 *
 * Pick'em is restricted to main seasons only. If the resolved season is
 * kind='event', the endpoint returns an empty leaderboard with a friendly
 * message — Pick'em does not run for event leaderboards.
 *
 * For archived seasons: returns the immutable pickem snapshot.
 * For non-archived seasons: live aggregation via race_leaderboard_bindings.
 */
import {
  errorResponse,
  successResponse,
} from '../../_shared/utils.js';

const MAX_ENTRIES = 50;

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    const url = new URL(context.request.url);
    const seasonIdParam = url.searchParams.get('season');
    const leaderboardIdParam = url.searchParams.get('leaderboardId');
    const allTime = url.searchParams.get('allTime') === 'true';

    // All-Time mode — aggregate across all scored predictions (legacy behavior)
    if (allTime) {
      const { results } = await db
        .prepare(
          `SELECT rp.user_id, m.name AS member_name, m.trainer_id,
                  COUNT(rp.id) AS races_predicted,
                  SUM(COALESCE(rp.score, 0)) AS total_score
           FROM race_predictions rp
           JOIN members m ON m.id = rp.user_id
           WHERE rp.score IS NOT NULL
           GROUP BY rp.user_id
           ORDER BY total_score DESC, races_predicted ASC
           LIMIT ?`
        )
        .bind(MAX_ENTRIES)
        .all();

      const leaderboard = results.map((row, index) => ({
        rank: index + 1,
        userId: row.user_id,
        memberName: row.member_name,
        trainerId: row.trainer_id,
        avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.user_id}`,
        racesPredicted: row.races_predicted,
        totalScore: row.total_score,
      }));

      return successResponse('Leaderboard loaded (all-time).', {
        season: null,
        allTime: true,
        leaderboard,
      });
    }

    // Resolve the target pickem leaderboard
    let targetLb = null;
    let targetSeason = null;

    if (leaderboardIdParam) {
      const lbId = parseInt(leaderboardIdParam, 10);
      if (!lbId || isNaN(lbId)) {
        return errorResponse('leaderboardId must be a valid integer.');
      }
      targetLb = await db
        .prepare(
          `SELECT lb.id, lb.season_id, lb.division,
                  s.label AS season_label, s.kind AS season_kind,
                  s.start_date AS season_start, s.end_date AS season_end,
                  s.status AS season_status, s.archived_at
           FROM leaderboards lb
           JOIN seasons s ON s.id = lb.season_id
           WHERE lb.id = ? AND lb.division = 'pickem'`
        )
        .bind(lbId)
        .first();
      if (!targetLb) {
        return errorResponse(`Pick'em leaderboard #${lbId} not found (or it's not a pickem division leaderboard).`, 404);
      }
      targetSeason = {
        id: targetLb.season_id,
        label: targetLb.season_label,
        kind: targetLb.season_kind,
        startDate: targetLb.season_start,
        endDate: targetLb.season_end,
        status: targetLb.season_status,
        archivedAt: targetLb.archived_at,
      };
    } else {
      // Resolve by season param (or default to active main season)
      let resolvedSeasonId = seasonIdParam;
      if (!resolvedSeasonId) {
        const activeMain = await db
          .prepare(`SELECT id FROM seasons WHERE kind = 'main' AND status = 'active' LIMIT 1`)
          .first();
        if (!activeMain) {
          return successResponse('No active main season found.', {
            season: null,
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

      // Pick'em is main-season-only — reject event seasons
      if (targetSeason.kind === 'event') {
        return successResponse('Pick\'em is not available for event seasons. Pick\'m runs only for main weekly/biweekly seasons.', {
          season: {
            id: targetSeason.id,
            label: targetSeason.label,
            kind: targetSeason.kind,
            status: targetSeason.status,
          },
          leaderboard: [],
        });
      }

      // Fetch the pickem leaderboard for this season
      targetLb = await db
        .prepare(`SELECT id, division FROM leaderboards WHERE season_id = ? AND division = 'pickem'`)
        .bind(resolvedSeasonId)
        .first();
      // If no pickem leaderboard exists (season has is_pickem_active=0), return empty
      if (!targetLb) {
        return successResponse(`Season "${resolvedSeasonId}" does not have Pick'em enabled.`, {
          season: {
            id: targetSeason.id,
            label: targetSeason.label,
            kind: targetSeason.kind,
            status: targetSeason.status,
            isPickemActive: targetSeason.is_pickem_active === 1,
          },
          leaderboard: [],
        });
      }
    }

    // For archived seasons, return the immutable snapshot
    if (targetSeason.status === 'archived') {
      const snapshot = await db
        .prepare(`SELECT snapshot_json, snapshot_taken_at
                  FROM season_archive_snapshots
                  WHERE season_id = ? AND division = 'pickem' AND is_locked = 1
                  LIMIT 1`)
        .bind(targetSeason.id)
        .first();

      if (!snapshot) {
        return successResponse('No archived Pick\'em snapshot for this season.', {
          season: {
            id: targetSeason.id,
            label: targetSeason.label,
            status: targetSeason.status,
            archivedAt: targetSeason.archivedAt,
            isSnapshot: true,
          },
          leaderboard: [],
        });
      }

      const parsed = JSON.parse(snapshot.snapshot_json);
      return successResponse('Pick\'em leaderboard loaded from archived snapshot.', {
        season: {
          id: targetSeason.id,
          label: targetSeason.label,
          status: targetSeason.status,
          archivedAt: targetSeason.archivedAt,
          isSnapshot: true,
          snapshotTakenAt: snapshot.snapshot_taken_at,
          raceCount: parsed.raceCount || 0,
        },
        leaderboard: parsed.leaderboard || [],
      });
    }

    // Live aggregation via race_leaderboard_bindings
    const raceCountRow = await db
      .prepare(
        `SELECT COUNT(DISTINCT rp.race_id) AS race_count
         FROM race_predictions rp
         JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
         WHERE rp.score IS NOT NULL
           AND rlb.leaderboard_id = ?`
      )
      .bind(targetLb.id)
      .first();
    const raceCount = raceCountRow?.race_count || 0;

    if (raceCount === 0) {
      return successResponse('No scored predictions yet for this season.', {
        season: {
          id: targetSeason.id,
          label: targetSeason.label,
          status: targetSeason.status,
          raceCount: 0,
        },
        leaderboard: [],
      });
    }

    const { results } = await db
      .prepare(
        `SELECT rp.user_id, m.name AS member_name, m.trainer_id,
                COUNT(rp.id) AS races_predicted,
                SUM(COALESCE(rp.score, 0)) AS total_score
         FROM race_predictions rp
         JOIN members m ON m.id = rp.user_id
         JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
         WHERE rp.score IS NOT NULL
           AND rlb.leaderboard_id = ?
         GROUP BY rp.user_id
         ORDER BY total_score DESC, races_predicted ASC
         LIMIT ?`
      )
      .bind(targetLb.id, MAX_ENTRIES)
      .all();

    const leaderboard = results.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      memberName: row.member_name,
      trainerId: row.trainer_id,
      avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.user_id}`,
      racesPredicted: row.races_predicted,
      totalScore: row.total_score,
    }));

    return successResponse('Leaderboard loaded.', {
      season: {
        id: targetSeason.id,
        label: targetSeason.label,
        status: targetSeason.status,
        raceCount,
      },
      leaderboard,
    });
  } catch (error) {
    console.error('Leaderboard GET error:', error.message, error.stack);
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
