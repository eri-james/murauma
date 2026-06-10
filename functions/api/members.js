/**
 * GET /api/members — List Approved Members
 *
 * Returns approved members sorted by most recent first.
 * Supports pagination via ?page=N&limit=N (default: page=1, limit=50).
 * Used by the Members page on index.html to display the member grid.
 * Profile pictures are served via /api/avatar/{trainer_id} or /api/avatar/{member_id}.
 * Data was sanitized on insert — serve as-is.
 */
import {
  errorResponse,
} from '../_shared/utils.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit')) || DEFAULT_LIMIT));
    const offset = (page - 1) * limit;

    const { results } = await db
      .prepare(
        `SELECT id, trainer_id, name, favorite_uma, bio, created_at
         FROM members
         WHERE status = 'approved'
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all();

    // Get total count for pagination info
    const countResult = await db
      .prepare('SELECT COUNT(*) as total FROM members WHERE status = \'approved\'')
      .first();

    // Data was sanitized on insert — serve as-is (no double-sanitization)
    const members = results.map(row => ({
      id: row.id,
      trainerId: row.trainer_id,
      name: row.name || 'Anonymous',
      favoriteUma: row.favorite_uma || '',
      bio: row.bio || '',
      // Use trainer_id for avatar if available, otherwise use numeric id
      avatarUrl: row.trainer_id
        ? `/api/avatar/${row.trainer_id}`
        : `/api/avatar/${row.id}`,
      joinedAt: row.created_at,
    }));

    return new Response(JSON.stringify({
      result: 'success',
      members,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      },
    }), {
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
