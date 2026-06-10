/**
 * Admin API — Member Management (List + Delete)
 *
 * GET    /api/admin/members?status=pending   — List members by status
 * DELETE /api/admin/members                  — Delete a member by ID (cascading)
 * POST   /api/admin/members/approve         — (see members/approve.js)
 * POST   /api/admin/members/reject          — (see members/reject.js)
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
      .prepare('SELECT id, username, name, trainer_id, favorite_uma, bio, role, status, created_at FROM members WHERE status = ? ORDER BY created_at DESC')
      .bind(status)
      .all();

    // Data was sanitized on insert — serve as-is
    const items = results.map(row => ({
      id: row.id,
      username: row.username || '',
      name: row.name || '',
      trainerId: row.trainer_id,
      favoriteUma: row.favorite_uma || '',
      bio: row.bio || '',
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
    }));

    return successResponse(`Members with status '${status}'`, { items });

  } catch (error) {
    console.error('Admin list members error:', error.message);
    return errorResponse('Failed to list members.', 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid member ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, name FROM members WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Member not found.');
    }

    // D1 doesn't support cascading deletes, so manually delete related data
    // 1. Delete guide_votes for guides authored by this member
    await db
      .prepare('DELETE FROM guide_votes WHERE guide_id IN (SELECT id FROM guides WHERE user_id = ?)')
      .bind(data.id)
      .run();

    // 2. Delete guides by this member
    await db
      .prepare('DELETE FROM guides WHERE user_id = ?')
      .bind(data.id)
      .run();

    // 3. Delete fan_media by this member
    await db
      .prepare('DELETE FROM fan_media WHERE user_id = ?')
      .bind(data.id)
      .run();

    // 4. Delete writings by this member
    await db
      .prepare('DELETE FROM writings WHERE user_id = ?')
      .bind(data.id)
      .run();

    // 5. Delete the member
    await db
      .prepare('DELETE FROM members WHERE id = ?')
      .bind(data.id)
      .run();

    return successResponse(`Member #${data.id} ("${existing.name}") and all their related content have been permanently deleted.`);

  } catch (error) {
    console.error('Admin delete member error:', error.message);
    return errorResponse('Failed to delete member.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'DELETE', 'OPTIONS']);
}
