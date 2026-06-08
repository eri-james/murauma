/**
 * Admin API — Member Management (List only)
 *
 * GET /api/admin/members?status=pending   — List members by status
 * POST /api/admin/members/approve         — (see members/approve.js)
 * POST /api/admin/members/reject          — (see members/reject.js)
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return errorResponse('Invalid status. Use: pending, approved, or rejected.');
    }

    const { results } = await db
      .prepare('SELECT id, username, name, trainer_id, favorite_uma, bio, status, created_at FROM members WHERE status = ? ORDER BY created_at DESC')
      .bind(status)
      .all();

    // Data was sanitized on insert — serve as-is
    const members = results.map(row => ({
      id: row.id,
      username: row.username || '',
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

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'OPTIONS']);
}
