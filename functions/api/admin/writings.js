/**
 * Admin API — Writing Management
 *
 * All endpoints require the ADMIN_SECRET header for authentication.
 * Set ADMIN_SECRET in Cloudflare Dashboard → Pages → murauma → Settings → Environment variables.
 *
 * Endpoints:
 *   GET    /api/admin/writings?status=pending         — List writings by status
 *   POST   /api/admin/writings/approve                 — Approve a writing by ID
 *   POST   /api/admin/writings/reject                  — Reject a writing by ID
 *   DELETE /api/admin/writings                         — Delete a writing by ID
 */
import {
  errorResponse,
  successResponse,
  sanitizeText,
  sanitizeHtml,
} from '../../_shared/utils.js';

/**
 * Validates the admin secret from the request header.
 */
function authenticate(request, env) {
  const secret = request.headers.get('X-Admin-Secret');
  if (!secret || secret !== env.ADMIN_SECRET) {
    return false;
  }
  return true;
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

    const writings = results.map(row => ({
      id: row.id,
      title: sanitizeText(row.title || ''),
      authorName: sanitizeText(row.author_name || ''),
      trainerId: row.trainer_id,
      contentPreview: sanitizeHtml((row.content || '').substring(0, 300)),
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
 * POST /api/admin/writings/approve or /api/admin/writings/reject
 * Body: { id: 123 }
 *
 * DELETE /api/admin/writings
 * Body: { id: 123 }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  if (!authenticate(request, env)) {
    return errorResponse('Unauthorized.', 401);
  }

  try {
    const data = await request.json();
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Determine action from URL path
    let action;
    if (pathname.endsWith('/approve')) {
      action = 'approve';
    } else if (pathname.endsWith('/reject')) {
      action = 'reject';
    } else {
      return errorResponse('Unknown action. Use /approve or /reject.');
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

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

    if (existing.status === newStatus) {
      return errorResponse(`Writing is already ${newStatus}.`);
    }

    await db
      .prepare('UPDATE writings SET status = ? WHERE id = ?')
      .bind(newStatus, data.id)
      .run();

    return successResponse(`Writing #${data.id} ("${existing.title}") has been ${newStatus}.`);

  } catch (error) {
    console.error('Admin update writing error:', error.message);
    return errorResponse('Failed to update writing status.', 500);
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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    },
  });
}
