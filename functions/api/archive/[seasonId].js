/**
 * Public API — Archived Season Standings (Single Division)
 *
 * GET /api/archive/<seasonId>?division=graded — Fetch the immutable snapshot
 * for one division of an archived season.
 *
 * This is the ONLY endpoint that returns archived standings — the live
 * aggregation query (e.g. /api/race-leaderboard?season=...) is bypassed
 * for archived seasons to guarantee immutability.
 *
 * Path params:
 *   seasonId — e.g. "2026s1"
 *
 * Query params:
 *   division — Required. One of: open, graded, pickem
 *
 * Response shape:
 *   {
 *     "result": "success",
 *     "season": { "id": "2026s1", "label": "Season 1 2026", "archivedAt": "2026-10-01T..." },
 *     "division": "graded",
 *     "raceCount": 12,
 *     "snapshotTakenAt": "2026-10-01T12:00:00Z",
 *     "leaderboard": [ { "rank": 1, "memberName": "...", "totalPoints": 95, ... }, ... ]
 *   }
 */
import {
  errorResponse,
  successResponse,
} from '../../_shared/utils.js';

const VALID_DIVISIONS = ['open', 'graded', 'pickem'];

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const db = env.DB;

  try {
    const seasonId = params.seasonId;
    if (!seasonId || typeof seasonId !== 'string' || seasonId.length > 50) {
      return errorResponse('Valid seasonId is required.');
    }

    const url = new URL(request.url);
    const division = (url.searchParams.get('division') || '').toLowerCase();
    if (!VALID_DIVISIONS.includes(division)) {
      return errorResponse('division query param is required and must be one of: open, graded, pickem.');
    }

    // Verify the season exists and is archived
    const season = await db
      .prepare(`SELECT id, label, kind, start_date, end_date, archived_at
                FROM seasons
                WHERE id = ? AND status = 'archived'`)
      .bind(seasonId)
      .first();

    if (!season) {
      return errorResponse('Archived season not found. Either the seasonId is invalid, the season does not exist, or it has not been archived yet.', 404);
    }

    // Fetch the immutable snapshot for this division
    const snapshot = await db
      .prepare(`SELECT snapshot_json, snapshot_taken_at
                FROM season_archive_snapshots
                WHERE season_id = ? AND division = ? AND is_locked = 1
                LIMIT 1`)
      .bind(seasonId, division)
      .first();

    if (!snapshot) {
      return errorResponse(`No archived snapshot exists for ${seasonId} / ${division} division.`, 404);
    }

    // Parse the snapshot JSON — it was stored as a complete leaderboard payload
    let parsed;
    try {
      parsed = JSON.parse(snapshot.snapshot_json);
    } catch (e) {
      console.error(`Corrupt snapshot JSON for ${seasonId}/${division}:`, e.message);
      return errorResponse('Archived snapshot data is corrupt. Contact an administrator.', 500);
    }

    return successResponse('Archive snapshot loaded.', {
      season: {
        id: season.id,
        label: season.label,
        kind: season.kind,
        startDate: season.start_date,
        endDate: season.end_date,
        archivedAt: season.archived_at,
      },
      division,
      raceCount: parsed.raceCount || 0,
      snapshotTakenAt: snapshot.snapshot_taken_at,
      leaderboard: parsed.leaderboard || [],
      // Include any extra metadata stored in the snapshot (e.g. snapshotInfo)
      ...(parsed.seasonInfo ? { seasonInfo: parsed.seasonInfo } : {}),
    });
  } catch (error) {
    console.error('Archive snapshot GET error:', error.message, error.stack);
    return errorResponse(`Failed to load archive snapshot: ${error.message}`, 500);
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
