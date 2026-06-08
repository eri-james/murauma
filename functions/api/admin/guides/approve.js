/**
 * POST /api/admin/guides/approve — Approve a guide by ID
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
      return errorResponse('Valid guide ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, status, title FROM guides WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Guide not found.');
    }

    if (existing.status === 'approved') {
      return errorResponse('This guide is already approved.');
    }

    await db
      .prepare('UPDATE guides SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind('approved', data.id)
      .run();

    return successResponse(`Guide #${data.id} ("${existing.title}") has been approved.`);

  } catch (error) {
    console.error('Admin approve guide error:', error.message);
    return errorResponse('Failed to approve guide.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
