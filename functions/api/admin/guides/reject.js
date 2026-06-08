/**
 * POST /api/admin/guides/reject — Reject a guide by ID
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

    if (existing.status === 'rejected') {
      return errorResponse('This guide is already rejected.');
    }

    await db
      .prepare('UPDATE guides SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind('rejected', data.id)
      .run();

    return successResponse(`Guide #${data.id} ("${existing.title}") has been rejected.`);

  } catch (error) {
    console.error('Admin reject guide error:', error.message);
    return errorResponse('Failed to reject guide.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
