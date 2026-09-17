/**
 * Admin API — Season Standings Preview
 *
 * GET /api/admin/seasons/standings?id=<seasonId>&division=graded
 *
 * Previews the current standings for a season (before archiving).
 * Useful for admin to verify results are correct before taking
 * the immutable snapshot.
 *
 * For archived seasons, this endpoint returns the snapshot data
 * instead of running the live aggregation (same as public archive endpoint).
 *
 * Query params:
 *   id        — Required. Season id (e.g. "2026s1")
 *   division  — Required. One of: open, graded, pickem
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

const VALID_DIVISIONS = ['open', 'graded', 'pickem'];
const MAX_LEADERBOARD_ENTRIES = 200;

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const seasonId = url.searchParams.get('id');
    const division = (url.searchParams.get('division') || '').toLowerCase();

    if (!seasonId) {
      return errorResponse('id (season id) query param is required.');
    }
    if (!VALID_DIVISIONS.includes(division)) {
      return errorResponse('division query param is required and must be one of: open, graded, pickem.');
    }

    const season = await db
      .prepare(`SELECT id, label, kind, start_date, end_date, status, is_pickem_active, archived_at
                FROM seasons WHERE id = ?`)
      .bind(seasonId)
      .first();

    if (!season) {
      return errorResponse(`Season "${seasonId}" not found.`, 404);
    }

    // If archived, return the snapshot
    if (season.status === 'archived') {
      const snapshot = await db
        .prepare(`SELECT snapshot_json, snapshot_taken_at
                  FROM season_archive_snapshots
                  WHERE season_id = ? AND division = ? AND is_locked = 1
                  LIMIT 1`)
        .bind(seasonId, division)
        .first();

      if (!snapshot) {
        return errorResponse(`No archived snapshot for ${seasonId}/${division}.`, 404);
      }
      const parsed = JSON.parse(snapshot.snapshot_json);

      return successResponse('Archived season standings (immutable snapshot).', {
        season: {
          id: season.id,
          label: season.label,
          status: season.status,
          archivedAt: season.archived_at,
        },
        division,
        isSnapshot: true,
        snapshotTakenAt: snapshot.snapshot_taken_at,
        raceCount: parsed.raceCount || 0,
        leaderboard: parsed.leaderboard || [],
      });
    }

    // Live preview — resolve the leaderboard for this division
    const lb = await db
      .prepare(`SELECT id FROM leaderboards WHERE season_id = ? AND division = ?`)
      .bind(seasonId, division)
      .first();

    if (!lb) {
      return errorResponse(`No ${division} leaderboard exists for season "${seasonId}".`, 404);
    }

    // Compute live standings
    const standings = await computeLiveStandings(db, seasonId, lb.id, division);

    return successResponse('Live standings preview.', {
      season: {
        id: season.id,
        label: season.label,
        status: season.status,
        startDate: season.start_date,
        endDate: season.end_date,
      },
      division,
      isSnapshot: false,
      raceCount: standings.raceCount,
      leaderboard: standings.leaderboard,
    });
  } catch (error) {
    console.error('Admin standings preview error:', error.message, error.stack);
    return errorResponse(`Failed to load standings: ${error.message}`, 500);
  }
}

// ============================================================
// Helper: compute live standings for one division
// ============================================================
// Mirrors the logic in /api/admin/seasons/archive.js — keep in sync.
// If this gets complex, extract to a shared module later.
async function computeLiveStandings(db, seasonId, leaderboardId, division) {
  if (division === 'pickem') {
    return computeLivePickem(db, leaderboardId);
  }

  // Racer leaderboard
  const raceCountRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT rp.race_id) AS race_count
       FROM race_participants rp
       JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
       WHERE rp.position IS NOT NULL
         AND rlb.leaderboard_id = ?
         AND rp.category = ?`
    )
    .bind(leaderboardId, division)
    .first();
  const raceCount = raceCountRow?.race_count || 0;

  if (raceCount === 0) {
    return { raceCount: 0, leaderboard: [] };
  }

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
       ORDER BY total_points DESC, wins DESC, seconds DESC, thirds DESC, total_races ASC
       LIMIT ?`
    )
    .bind(leaderboardId, division, MAX_LEADERBOARD_ENTRIES)
    .all();

  const leaderboard = results.map((row, index) => ({
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

  return { raceCount, leaderboard };
}

async function computeLivePickem(db, leaderboardId) {
  const raceCountRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT rp.race_id) AS race_count
       FROM race_predictions rp
       JOIN race_leaderboard_bindings rlb ON rlb.race_id = rp.race_id
       WHERE rp.score IS NOT NULL
         AND rlb.leaderboard_id = ?`
    )
    .bind(leaderboardId)
    .first();
  const raceCount = raceCountRow?.race_count || 0;

  if (raceCount === 0) {
    return { raceCount: 0, leaderboard: [] };
  }

  const { results } = await db
    .prepare(
      `SELECT
          rp.user_id,
          m.name AS member_name,
          m.trainer_id,
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
    .bind(leaderboardId, MAX_LEADERBOARD_ENTRIES)
    .all();

  const leaderboard = results.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    memberId: row.user_id,
    memberName: row.member_name,
    trainerId: row.trainer_id,
    avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.user_id}`,
    racesPredicted: row.races_predicted,
    totalScore: row.total_score,
  }));

  return { raceCount, leaderboard };
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'OPTIONS']);
}
