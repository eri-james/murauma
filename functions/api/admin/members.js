/**
 * Admin API — Member Management (List only)
 *
 * Requires the X-Admin-Secret header for authentication.
 *
 * Endpoints:
 *   GET /api/admin/members?status=pending   — List members by status
 *   POST /api/admin/members/approve         — (see members/approve.js)
 *   POST /api/admin/members/reject          — (see members/reject.js)
 */
import {
  errorResponse,
  successResponse,
  sanitizeText,
} from '../../_shared/utils.js';

/**
 * Validates the admin secret from the request header.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function authenticate(request, env) {
  const secret = request.headers.get('X-Admin-Secret');
  if (!secret || !env.ADMIN_SECRET) return false;
  // Timing-safe comparison
  if (secret.length !== env.ADMIN_SECRET.length) return false;
  let result = 0;
  for (let i = 0; i < secret.length; i++) {
    result |= secret.charCodeAt(i) ^ env.ADMIN_SECRET.charCodeAt(i);
  }
  return result === 0;
}

/**
 * GET /api/admin/members — List members by status
 * Query params: status (pending|approved|rejected), default: pending
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticate(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return errorResponse('Invalid status. Use: pending, approved, or rejected.');
    }

    const { results } = await db
      .prepare('SELECT id, name, trainer_id, favorite_uma, bio, status, created_at FROM members WHERE status = ? ORDER BY created_at DESC')
      .bind(status)
      .all();

    // Data was sanitized on insert — serve as-is
    const members = results.map(row => ({
      id: row.id,
      name: row.name || '',
      trainerId: row.trainer_id,
      favoriteUma: row.favorite_uma || '',
      bio: row.bio || '',
      status: row.status,
      createdAt: row.created_at,
    }));

    return successResponse(`Members with status '${status}'`, { members });

  } catch (error) {
    console.error('Admin list members error:', error.message);
    return errorResponse('Failed to list members.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://murauma.pages.dev',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    },
  });
}
