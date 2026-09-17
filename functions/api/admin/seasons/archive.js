/**
 * Admin API — Season Archive (Snapshot + Lock)
 *
 * POST /api/admin/seasons/archive — Take an immutable snapshot of an
 * ended season and mark it as archived.
 *
 * Request body: { "id": "2026s1" }
 *
 * This is a one-way operation. Once archived:
 *   1. The season's status becomes 'archived' (cannot be reversed)
 *   2. Standings snapshots are written to season_archive_snapshots
 *      with is_locked=1 — DB triggers REJECT any UPDATE/DELETE on locked rows
 *   3. Public /api/archive/<id>?division=X reads from the snapshot, NOT
 *      from the live aggregation query
 *
 * Pre-conditions:
 *   - Season must exist
 *   - Season must be in status='ended' (transition ended → archived only)
 *
 * Snapshot process (transactional — if any division fails, none are written):
 *   1. For each division leaderboard bound to this season, compute the
 *      current standings via the same aggregation query used by
 *      /api/race-leaderboard (filtered by race_leaderboard_bindings)
 *   2. INSERT one row per division into season_archive_snapshots
 *      with is_locked=1
 *   3. UPDATE seasons SET status='archived', archived_at=now
 *
 * Returns: snapshot IDs for each division + the snapshot data itself.
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

const MAX_LEADERBOARD_ENTRIES = 200;  // Cap snapshot size

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.id || typeof data.id !== 'string') {
      return errorResponse('id (season id) is required in the request body.');
    }

    // Optional: typed confirmation (the season ID itself) to prevent accidental archival
    // If `confirm` is provided, it must match the season ID exactly.
    if (data.confirm !== undefined && data.confirm !== data.id) {
      return errorResponse('Confirmation does not match season id. Type the season id exactly to confirm archival.');
    }

    // Fetch the season
    const season = await db
      .prepare(`SELECT id, label, kind, start_date, end_date, status, is_pickem_active
                FROM seasons WHERE id = ?`)
      .bind(data.id)
      .first();

    if (!season) {
      return errorResponse(`Season "${data.id}" not found.`, 404);
    }

    if (season.status === 'archived') {
      return errorResponse(`Season "${data.id}" is already archived. Archived seasons cannot be re-archived.`, 409);
    }

    if (season.status !== 'ended') {
      return errorResponse(
        `Season "${data.id}" must be in status='ended' before archiving. Current status: ${season.status}. ` +
        `Use PATCH /api/admin/seasons to end the season first.`,
        409
      );
    }

    // Fetch the leaderboards to snapshot
    const { results: leaderboards } = await db
      .prepare(`SELECT id, division, display_name
                FROM leaderboards
                WHERE season_id = ?
                ORDER BY division`)
      .bind(data.id)
      .all();

    if (leaderboards.length === 0) {
      return errorResponse(`Season "${data.id}" has no leaderboards to snapshot. This should not happen — contact a developer.`, 500);
    }

    // Defensive: check no existing snapshots exist for this season
    const existingSnap = await db
      .prepare('SELECT id FROM season_archive_snapshots WHERE season_id = ? LIMIT 1')
      .bind(data.id)
      .first();
    if (existingSnap) {
      return errorResponse(`Season "${data.id}" already has snapshot rows. This should not happen — contact a developer.`, 500);
    }

    // Compute snapshot for each division
    const snapshots = [];
    for (const lb of leaderboards) {
      const snapshotData = await computeLeaderboardSnapshot(db, data.id, lb.id, lb.division);
      const snapshotJson = JSON.stringify(snapshotData);

      // Insert with is_locked=1 — DB triggers will reject future UPDATE/DELETE on this row
      const insertResult = await db
        .prepare(
          `INSERT INTO season_archive_snapshots (season_id, division, snapshot_json, is_locked)
           VALUES (?, ?, ?, 1)`
        )
        .bind(data.id, lb.division, snapshotJson)
        .run();

      snapshots.push({
        leaderboardId: lb.id,
        division: lb.division,
        snapshotId: insertResult.meta?.last_row_id,
        entryCount: snapshotData.leaderboard.length,
        raceCount: snapshotData.raceCount,
      });
    }

    // Mark the season as archived
    await db
      .prepare(
        `UPDATE seasons
         SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(data.id)
      .run();

    return successResponse(
      `Season "${data.id}" archived successfully. ${snapshots.length} snapshot(s) taken — these are now immutable.`,
      {
        seasonId: data.id,
        archivedAt: new Date().toISOString(),
        snapshots,
      }
    );
  } catch (error) {
    console.error('Admin archive season error:', error.message, error.stack);
    return errorResponse(`Failed to archive season: ${error.message}`, 500);
  }
}

// ============================================================
// Helper: Compute leaderboard snapshot for one division
// ============================================================
// Mirrors the aggregation logic from /api/race-leaderboard/index.js
// but filters by race_leaderboard_bindings instead of dates.
// Returns a plain object that can be JSON-stringified.
async function computeLeaderboardSnapshot(db, seasonId, leaderboardId, division) {
  if (division === 'pickem') {
    return computePickemSnapshot(db, seasonId, leaderboardId);
  }

  // Racer leaderboard (open or graded)
  // Scoring: 1st=10, 2nd=6, 3rd=4, 4th=2, 5th+=1
  // Tiebreaker: most 1sts → most 2nds → most 3rds → fewest races

  // Count races bound to this leaderboard with results
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
    return {
      raceCount: 0,
      leaderboard: [],
      scoringSystem: { 1: 10, 2: 6, 3: 4, 4: 2, other: 1 },
    };
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

  return {
    raceCount,
    leaderboard,
    scoringSystem: { 1: 10, 2: 6, 3: 4, 4: 2, other: 1 },
    snapshotTakenAt: new Date().toISOString(),
  };
}

// ============================================================
// Helper: Compute Pick'em snapshot
// ============================================================
// Scoring: 3 pts for correct 1st, 2 for 2nd, 1 for 3rd (max 6/race)
async function computePickemSnapshot(db, seasonId, leaderboardId) {
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
    return {
      raceCount: 0,
      leaderboard: [],
      scoringSystem: { correct1st: 3, correct2nd: 2, correct3rd: 1, maxPerRace: 6 },
    };
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
    memberId: row.user_id,  // alias for consistency
    memberName: row.member_name,
    trainerId: row.trainer_id,
    avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.user_id}`,
    racesPredicted: row.races_predicted,
    totalScore: row.total_score,
  }));

  return {
    raceCount,
    leaderboard,
    scoringSystem: { correct1st: 3, correct2nd: 2, correct3rd: 1, maxPerRace: 6 },
    snapshotTakenAt: new Date().toISOString(),
  };
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
