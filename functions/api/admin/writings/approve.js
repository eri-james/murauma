/**
 * POST /api/admin/writings/approve — Approve a writing by ID
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
      return errorResponse('Valid writing ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, status, title FROM writings WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Writing not found.');
    }

    if (existing.status === 'approved') {
      return errorResponse('Writing is already approved.');
    }

    await db
      .prepare('UPDATE writings SET status = ? WHERE id = ?')
      .bind('approved', data.id)
      .run();

    return successResponse(`Writing #${data.id} ("${existing.title}") has been approved.`);

  } catch (error) {
    console.error('Admin approve writing error:', error.message);
    return errorResponse('Failed to approve writing.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
