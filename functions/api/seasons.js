/**
 * Public API — Seasons
 *
 * GET /api/seasons — List all seasons (main + event), sorted by start_date DESC.
 *
 * Returns the season list with their leaderboards attached.
 * Public users see all seasons (including upcoming + archived) — no auth required.
 *
 * Query params:
 *   ?kind=main       — Filter by kind ('main' or 'event')
 *   ?status=active   — Filter by status ('upcoming'|'active'|'ended'|'archived')
 *
 * Response shape:
 *   {
 *     "result": "success",
 *     "seasons": [
 *       {
 *         "id": "2026s1",
 *         "label": "Season 1 2026",
 *         "kind": "main",
 *         "startDate": "2026-06-01",
 *         "endDate": null,
 *         "status": "active",
 *         "isActive": true,            // status === 'active'
 *         "isPickemActive": true,
 *         "description": "...",
 *         "archivedAt": null,
 *         "leaderboards": [
 *           { "id": 1, "division": "open", "displayName": "" },
 *           { "id": 2, "division": "graded", "displayName": "" },
 *           { "id": 3, "division": "pickem", "displayName": "" }
 *         ]
 *       }
 *     ]
 *   }
 */
import {
  errorResponse,
  successResponse,
} from '../_shared/utils.js';

const VALID_KINDS = ['main', 'event'];
const VALID_STATUSES = ['upcoming', 'active', 'ended', 'archived'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const kindFilter = url.searchParams.get('kind');
    const statusFilter = url.searchParams.get('status');

    // Validate filters
    if (kindFilter && !VALID_KINDS.includes(kindFilter)) {
      return errorResponse('kind must be "main" or "event".');
    }
    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
      return errorResponse('status must be one of: upcoming, active, ended, archived.');
    }

    // Build query — main ordering: active first, then by start_date DESC
    let query = `SELECT id, label, kind, start_date, end_date, status, description, is_pickem_active, archived_at
                 FROM seasons`;
    const conditions = [];
    const params = [];

    if (kindFilter) {
      conditions.push('kind = ?');
      params.push(kindFilter);
    }
    if (statusFilter) {
      conditions.push('status = ?');
      params.push(statusFilter);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ` ORDER BY
                 CASE status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END,
                 start_date DESC`;

    const { results: seasons } = await db.prepare(query).bind(...params).all();

    if (seasons.length === 0) {
      return successResponse('No seasons found.', { seasons: [] });
    }

    // Fetch leaderboards for all returned seasons in one batch
    const seasonIds = seasons.map(s => s.id);
    const placeholders = seasonIds.map(() => '?').join(',');
    const { results: lbs } = await db
      .prepare(`SELECT id, season_id, division, display_name, is_active
                FROM leaderboards
                WHERE season_id IN (${placeholders})
                ORDER BY season_id, division`)
      .bind(...seasonIds)
      .all();

    // Group leaderboards by season_id
    const lbBySeason = {};
    for (const lb of lbs) {
      if (!lbBySeason[lb.season_id]) lbBySeason[lb.season_id] = [];
      lbBySeason[lb.season_id].push({
        id: lb.id,
        division: lb.division,
        displayName: lb.display_name || '',
        isActive: lb.is_active === 1,
      });
    }

    const payload = seasons.map(s => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      startDate: s.start_date,
      endDate: s.end_date,
      status: s.status,
      isActive: s.status === 'active',
      isPickemActive: s.is_pickem_active === 1,
      description: s.description || '',
      archivedAt: s.archived_at,
      leaderboards: lbBySeason[s.id] || [],
    }));

    return successResponse('Seasons loaded.', { seasons: payload });
  } catch (error) {
    console.error('Seasons list GET error:', error.message, error.stack);
    return errorResponse(`Failed to load seasons: ${error.message}`, 500);
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
