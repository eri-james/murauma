/**
 * POST /api/admin/members/reject — Reject a member by trainer_id
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

    if (existing.status === 'rejected') {
      return errorResponse('Member is already rejected.');
    }

    await db
      .prepare('UPDATE members SET status = ? WHERE trainer_id = ?')
      .bind('rejected', data.trainerId)
      .run();

    return successResponse(`Member ${data.trainerId} has been rejected.`);

  } catch (error) {
    console.error('Admin reject member error:', error.message);
    return errorResponse('Failed to reject member.', 500);
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
