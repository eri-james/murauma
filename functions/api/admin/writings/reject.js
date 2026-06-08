/**
 * POST /api/admin/writings/reject — Reject a writing by ID
 */
import {
  errorResponse,
  successResponse,
  authenticateAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticateAdmin(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

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

    if (existing.status === 'rejected') {
      return errorResponse('Writing is already rejected.');
    }

    await db
      .prepare('UPDATE writings SET status = ? WHERE id = ?')
      .bind('rejected', data.id)
      .run();

    return successResponse(`Writing #${data.id} ("${existing.title}") has been rejected.`);

  } catch (error) {
    console.error('Admin reject writing error:', error.message);
    return errorResponse('Failed to reject writing.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
