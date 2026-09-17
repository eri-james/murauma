/**
 * Public API — Archive List
 *
 * GET /api/archive — List all archived seasons (status='archived').
 *
 * Returns season metadata + which divisions have snapshots available.
 * Does NOT return the full standings — those are fetched per-season
 * via GET /api/archive/<seasonId>?division=graded.
 *
 * Response shape:
 *   {
 *     "result": "success",
 *     "archives": [
 *       {
 *         "seasonId": "2026s1",
 *         "label": "Season 1 2026",
 *         "kind": "main",
 *         "startDate": "2026-06-01",
 *         "endDate": "2026-09-30",
 *         "archivedAt": "2026-10-01T12:00:00Z",
 *         "divisions": ["open", "graded", "pickem"]
 *       }
 *     ]
 *   }
 */
import {
  errorResponse,
  successResponse,
} from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    // Fetch all archived seasons
    const { results: seasons } = await db
      .prepare(`SELECT id, label, kind, start_date, end_date, archived_at
                FROM seasons
                WHERE status = 'archived'
                ORDER BY archived_at DESC`)
      .all();

    if (seasons.length === 0) {
      return successResponse('No archived seasons yet.', { archives: [] });
    }

    // Fetch available divisions for each archived season (from snapshot table)
    const seasonIds = seasons.map(s => s.id);
    const placeholders = seasonIds.map(() => '?').join(',');
    const { results: snapshots } = await db
      .prepare(`SELECT season_id, division
                FROM season_archive_snapshots
                WHERE season_id IN (${placeholders})
                ORDER BY season_id, division`)
      .bind(...seasonIds)
      .all();

    const divisionsBySeason = {};
    for (const snap of snapshots) {
      if (!divisionsBySeason[snap.season_id]) divisionsBySeason[snap.season_id] = [];
      divisionsBySeason[snap.season_id].push(snap.division);
    }

    const archives = seasons.map(s => ({
      seasonId: s.id,
      label: s.label,
      kind: s.kind,
      startDate: s.start_date,
      endDate: s.end_date,
      archivedAt: s.archived_at,
      divisions: divisionsBySeason[s.id] || [],
    }));

    return successResponse('Archive list loaded.', { archives });
  } catch (error) {
    console.error('Archive list GET error:', error.message, error.stack);
    return errorResponse(`Failed to load archive list: ${error.message}`, 500);
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
