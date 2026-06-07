/**
 * Admin API — Member Management
 *
 * All endpoints require the ADMIN_SECRET header for authentication.
 * Set ADMIN_SECRET in Cloudflare Dashboard → Pages → murauma → Settings → Environment variables.
 *
 * Endpoints:
 *   GET  /api/admin/members?status=pending   — List members by status
 *   POST /api/admin/members/approve          — Approve a member by trainer_id
 *   POST /api/admin/members/reject           — Reject a member by trainer_id
 */
import {
  errorResponse,
  successResponse,
  sanitizeText,
} from '../../_shared/utils.js';

/**
 * Validates the admin secret from the request header.
 */
function authenticate(request, env) {
  const secret = request.headers.get('X-Admin-Secret');
  if (!secret || secret !== env.ADMIN_SECRET) {
    return false;
  }
  return true;
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

    const members = results.map(row => ({
      id: row.id,
      name: sanitizeText(row.name || ''),
      trainerId: row.trainer_id,
      favoriteUma: sanitizeText(row.favorite_uma || ''),
      bio: sanitizeText(row.bio || ''),
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
 * POST /api/admin/members/approve — Approve a member
 * Body: { trainerId: "123456789012" }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticate(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    const data = await request.json();
    const action = request.url.endsWith('/reject') ? 'reject' : 'approve';
    const newStatus = action === 'reject' ? 'rejected' : 'approved';

    if (!data.trainerId || !/^\d{12}$/.test(data.trainerId)) {
      return errorResponse('Valid 12-digit Trainer ID is required.');
    }

    const existing = await db
      .prepare('SELECT id, status FROM members WHERE trainer_id = ?')
      .bind(data.trainerId)
      .first();

    if (!existing) {
      return errorResponse('Member not found.');
    }

    if (existing.status === newStatus) {
      return errorResponse(`Member is already ${newStatus}.`);
    }

    await db
      .prepare('UPDATE members SET status = ? WHERE trainer_id = ?')
      .bind(newStatus, data.trainerId)
      .run();

    return successResponse(`Member ${data.trainerId} has been ${newStatus}.`);

  } catch (error) {
    console.error('Admin update member error:', error.message);
    return errorResponse('Failed to update member status.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    },
  });
}
