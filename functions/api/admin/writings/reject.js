/**
 * POST /api/admin/writings/reject — Reject a writing by ID
 */
import {
  errorResponse,
  successResponse,
} from '../../../_shared/utils.js';

function authenticate(request, env) {
  const secret = request.headers.get('X-Admin-Secret');
  if (!secret || !env.ADMIN_SECRET) return false;
  if (secret.length !== env.ADMIN_SECRET.length) return false;
  let result = 0;
  for (let i = 0; i < secret.length; i++) {
    result |= secret.charCodeAt(i) ^ env.ADMIN_SECRET.charCodeAt(i);
  }
  return result === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticate(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    const data = await request.json();

    // Validate writing ID
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
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://murauma.pages.dev',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    },
  });
}
