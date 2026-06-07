/**
 * Admin API — Writing Management (List + Delete)
 *
 * Requires the X-Admin-Secret header for authentication.
 *
 * Endpoints:
 *   GET    /api/admin/writings?status=pending  — List writings by status
 *   POST   /api/admin/writings/approve         — (see writings/approve.js)
 *   POST   /api/admin/writings/reject          — (see writings/reject.js)
 *   DELETE /api/admin/writings                 — Delete a writing by ID
 */
import {
  errorResponse,
  successResponse,
} from '../../_shared/utils.js';

/**
 * Timing-safe admin authentication.
 */
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

/**
 * GET /api/admin/writings — List writings by status
 * Query params: status (pending|approved|rejected), default: pending
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticate(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return errorResponse('Invalid status. Use: pending, approved, or rejected.');
    }

    const { results } = await db
      .prepare(
        `SELECT id, title, author_name, trainer_id, content, status, created_at
         FROM writings
         WHERE status = ?
         ORDER BY created_at DESC`
      )
      .bind(status)
      .all();

    // Data was sanitized on insert — serve as-is
    const writings = results.map(row => ({
      id: row.id,
      title: row.title || '',
      authorName: row.author_name || '',
      trainerId: row.trainer_id,
      contentPreview: (row.content || '').substring(0, 300),
      status: row.status,
      createdAt: row.created_at,
    }));

    return successResponse(`Writings with status '${status}'`, { writings });

  } catch (error) {
    console.error('Admin list writings error:', error.message);
    return errorResponse('Failed to list writings.', 500);
  }
}

/**
 * DELETE /api/admin/writings — Permanently delete a writing
 * Body: { id: 123 }
 */
export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticate(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    const data = await request.json();

    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid writing ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM writings WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Writing not found.');
    }

    await db
      .prepare('DELETE FROM writings WHERE id = ?')
      .bind(data.id)
      .run();

    return successResponse(`Writing #${data.id} ("${existing.title}") has been permanently deleted.`);

  } catch (error) {
    console.error('Admin delete writing error:', error.message);
    return errorResponse('Failed to delete writing.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://murauma.pages.dev',
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    },
  });
}
