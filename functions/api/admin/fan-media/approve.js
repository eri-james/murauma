/**
 * POST /api/admin/fan-media/approve — Approve a fan media entry by ID
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

    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid fan media ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, status, title FROM fan_media WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Fan media entry not found.');
    }

    if (existing.status === 'approved') {
      return errorResponse('This entry is already approved.');
    }

    await db
      .prepare('UPDATE fan_media SET status = ? WHERE id = ?')
      .bind('approved', data.id)
      .run();

    return successResponse(`Fan media #${data.id} ("${existing.title}") has been approved.`);

  } catch (error) {
    console.error('Admin approve fan media error:', error.message);
    return errorResponse('Failed to approve fan media.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
