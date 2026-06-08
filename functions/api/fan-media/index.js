/**
 * GET /api/fan-media — List Approved Fan Media (Public)
 *
 * Returns approved fan media, optionally filtered by type.
 * Results are sorted by most recent first.
 *
 * Query parameters:
 *   type — "art", "video", or "music" (optional, returns all if omitted)
 */
import {
  errorResponse,
} from '../../_shared/utils.js';

const VALID_TYPES = ['art', 'video', 'music'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');

    let query;
    let params = [];

    if (type && VALID_TYPES.includes(type)) {
      query = `
        SELECT fm.id, fm.type, fm.title, fm.description, fm.url, fm.author_name, fm.created_at,
               m.id AS member_id
        FROM fan_media fm
        LEFT JOIN members m ON fm.user_id = m.id
        WHERE fm.status = 'approved' AND fm.type = ?
        ORDER BY fm.created_at DESC
      `;
      params = [type];
    } else {
      query = `
        SELECT fm.id, fm.type, fm.title, fm.description, fm.url, fm.author_name, fm.created_at,
               m.id AS member_id
        FROM fan_media fm
        LEFT JOIN members m ON fm.user_id = m.id
        WHERE fm.status = 'approved'
        ORDER BY fm.created_at DESC
      `;
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const items = results.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title || '',
      description: row.description || '',
      url: row.url || '',
      author: row.author_name || 'Unknown',
      timestamp: row.created_at,
    }));

    return new Response(JSON.stringify({ result: 'success', items }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Cache for 30 seconds at the edge
        'Cache-Control': 'public, max-age=30',
      },
    });

  } catch (error) {
    console.error('List fan media error:', error.message);
    return errorResponse('Failed to load fan media.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
