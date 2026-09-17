/**
 * Admin API — Race Leaderboard Bindings
 *
 * GET    /api/admin/weekly-races/bind-leaderboards?raceId=N
 *   Returns the leaderboards this race is currently bound to.
 *
 * POST   /api/admin/weekly-races/bind-leaderboards
 *   Replaces all bindings for a race. Body:
 *     { "raceId": 42, "leaderboardIds": [1, 2, 4] }
 *   Pass an empty array to unbind the race from everything (rare —
 *   would effectively exclude the race from all leaderboards).
 *
 * Behavior:
 *   - Validates that the race exists
 *   - Validates that all leaderboard IDs exist and are active
 *   - Atomic replace: deletes all existing bindings for the race,
 *     then inserts the new set
 *   - Idempotent: posting the same bindings twice results in the
 *     same final state
 *
 * Note: Bindings can be changed at any time before a season is
 * archived. Once a season is archived, its snapshot is immutable —
 * changing bindings afterward does NOT affect the archived standings
 * (only the live aggregation, which is bypassed for archived seasons).
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

// ============================================================
// GET — List race's current bindings
// ============================================================
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const raceId = parseInt(url.searchParams.get('raceId'), 10);
    if (!raceId || isNaN(raceId)) {
      return errorResponse('Valid raceId query param is required.');
    }

    // Verify race exists
    const race = await db
      .prepare('SELECT id, title, season_id FROM weekly_races WHERE id = ?')
      .bind(raceId)
      .first();
    if (!race) {
      return errorResponse(`Race #${raceId} not found.`, 404);
    }

    // Fetch current bindings
    const { results: bindings } = await db
      .prepare(
        `SELECT rlb.leaderboard_id, lb.season_id, lb.division, lb.display_name,
                s.label AS season_label, s.status AS season_status
         FROM race_leaderboard_bindings rlb
         JOIN leaderboards lb ON lb.id = rlb.leaderboard_id
         JOIN seasons s ON s.id = lb.season_id
         WHERE rlb.race_id = ?
         ORDER BY s.start_date DESC, lb.division`
      )
      .bind(raceId)
      .all();

    // Fetch all available leaderboards (for the UI to show checkboxes)
    const { results: available } = await db
      .prepare(
        `SELECT lb.id, lb.season_id, lb.division, lb.display_name, lb.is_active,
                s.label AS season_label, s.kind AS season_kind, s.status AS season_status
         FROM leaderboards lb
         JOIN seasons s ON s.id = lb.season_id
         WHERE s.status IN ('upcoming', 'active', 'ended')
           AND lb.is_active = 1
         ORDER BY s.start_date DESC, lb.division`
      )
      .all();

    return successResponse('Race bindings loaded.', {
      race: {
        id: race.id,
        title: race.title,
        currentSeasonId: race.season_id,
      },
      bindings: bindings.map(b => ({
        leaderboardId: b.leaderboard_id,
        seasonId: b.season_id,
        division: b.division,
        displayName: b.display_name || '',
        seasonLabel: b.season_label,
        seasonStatus: b.season_status,
      })),
      available: available.map(a => ({
        leaderboardId: a.id,
        seasonId: a.season_id,
        division: a.division,
        displayName: a.display_name || '',
        seasonLabel: a.season_label,
        seasonKind: a.season_kind,
        seasonStatus: a.season_status,
      })),
    });
  } catch (error) {
    console.error('Admin get race bindings error:', error.message, error.stack);
    return errorResponse(`Failed to load race bindings: ${error.message}`, 500);
  }
}

// ============================================================
// POST — Replace all bindings for a race
// ============================================================
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.raceId || !Number.isInteger(data.raceId)) {
      return errorResponse('Valid raceId (integer) is required.');
    }

    if (!Array.isArray(data.leaderboardIds)) {
      return errorResponse('leaderboardIds must be an array (can be empty).');
    }

    // Validate all leaderboard IDs are integers
    for (const lbId of data.leaderboardIds) {
      if (!Number.isInteger(lbId)) {
        return errorResponse(`All leaderboardIds must be integers. Got: ${typeof lbId}`);
      }
    }

    // Verify race exists
    const race = await db
      .prepare('SELECT id, title FROM weekly_races WHERE id = ?')
      .bind(data.raceId)
      .first();
    if (!race) {
      return errorResponse(`Race #${data.raceId} not found.`, 404);
    }

    // If any leaderboard IDs provided, validate they all exist and are active
    if (data.leaderboardIds.length > 0) {
      const placeholders = data.leaderboardIds.map(() => '?').join(',');
      const { results: found } = await db
        .prepare(
          `SELECT lb.id, lb.season_id, lb.division, s.status AS season_status
           FROM leaderboards lb
           JOIN seasons s ON s.id = lb.season_id
           WHERE lb.id IN (${placeholders})`
        )
        .bind(...data.leaderboardIds)
        .all();

      if (found.length !== data.leaderboardIds.length) {
        const foundIds = new Set(found.map(f => f.id));
        const missing = data.leaderboardIds.filter(id => !foundIds.has(id));
        return errorResponse(`Leaderboard ID(s) not found: ${missing.join(', ')}`);
      }

      // Reject binding to archived-season leaderboards (snapshots are immutable)
      const archived = found.filter(f => f.season_status === 'archived');
      if (archived.length > 0) {
        return errorResponse(
          `Cannot bind to leaderboards of archived seasons (snapshots are immutable): ` +
          archived.map(a => `${a.season_id}/${a.division}`).join(', '),
          409
        );
      }
    }

    // Atomic replace: delete existing, insert new
    await db.prepare('DELETE FROM race_leaderboard_bindings WHERE race_id = ?').bind(data.raceId).run();

    for (const lbId of data.leaderboardIds) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
           VALUES (?, ?)`
        )
        .bind(data.raceId, lbId)
        .run();
    }

    // Fetch the final binding state to return
    const { results: finalBindings } = await db
      .prepare(
        `SELECT rlb.leaderboard_id, lb.season_id, lb.division, lb.display_name,
                s.label AS season_label
         FROM race_leaderboard_bindings rlb
         JOIN leaderboards lb ON lb.id = rlb.leaderboard_id
         JOIN seasons s ON s.id = lb.season_id
         WHERE rlb.race_id = ?
         ORDER BY s.start_date DESC, lb.division`
      )
      .bind(data.raceId)
      .all();

    return successResponse(
      `Race #${data.raceId} ("${race.title}") now bound to ${data.leaderboardIds.length} leaderboard(s).`,
      {
        raceId: data.raceId,
        bindings: finalBindings.map(b => ({
          leaderboardId: b.leaderboard_id,
          seasonId: b.season_id,
          division: b.division,
          displayName: b.display_name || '',
          seasonLabel: b.season_label,
        })),
      }
    );
  } catch (error) {
    console.error('Admin set race bindings error:', error.message, error.stack);
    return errorResponse(`Failed to set race bindings: ${error.message}`, 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'OPTIONS']);
}
