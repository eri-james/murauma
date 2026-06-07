/**
 * GET /api/members — List Approved Members
 *
 * Returns all approved members sorted by most recent first.
 * Used by the Members page on index.html to display the member grid.
 * Profile pictures are served via /api/avatar/{trainer_id}.
 */
import {
  errorResponse,
  sanitizeText,
} from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    const { results } = await db
      .prepare(
        `SELECT trainer_id, name, favorite_uma, bio, created_at
         FROM members
         WHERE status = 'approved'
         ORDER BY created_at DESC`
      )
      .all();

    // Sanitize data before sending to client
    const members = results.map(row => ({
      trainerId: row.trainer_id,
      name: sanitizeText(row.name || 'Anonymous'),
      favoriteUma: sanitizeText(row.favorite_uma || ''),
      bio: sanitizeText(row.bio || ''),
      avatarUrl: `/api/avatar/${row.trainer_id}`,
      joinedAt: row.created_at,
    }));

    return new Response(JSON.stringify({ result: 'success', members }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });

  } catch (error) {
    console.error('List members error:', error.message);
    return errorResponse('Failed to list members.', 500);
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
