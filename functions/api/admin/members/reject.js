/**
 * POST /api/admin/members/reject — Reject a member
 * 
 * Accepts either trainerId (12 digits) or memberId (numeric id).
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    let existing;

    if (data.memberId && Number.isInteger(data.memberId)) {
      existing = await db
        .prepare('SELECT id, name, status FROM members WHERE id = ?')
        .bind(data.memberId)
        .first();
    } else if (data.trainerId && /^\d{12}$/.test(data.trainerId)) {
      existing = await db
        .prepare('SELECT id, name, status FROM members WHERE trainer_id = ?')
        .bind(data.trainerId)
        .first();
    } else {
      return errorResponse('Valid Trainer ID or Member ID is required.');
    }

    if (!existing) {
      return errorResponse('Member not found.');
    }

    if (existing.status === 'rejected') {
      return errorResponse('Member is already rejected.');
    }

    await db
      .prepare('UPDATE members SET status = ? WHERE id = ?')
      .bind('rejected', existing.id)
      .run();

    return successResponse(`Member "${existing.name}" has been rejected.`);

  } catch (error) {
    console.error('Admin reject member error:', error.message);
    return errorResponse('Failed to reject member.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
