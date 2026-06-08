/**
 * Admin API — Guide Management (List + Delete)
 *
 * GET    /api/admin/guides?status=pending  — List guides by status
 * DELETE /api/admin/guides                 — Delete a guide by ID
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return errorResponse('Invalid status. Use: pending, approved, or rejected.');
    }

    const { results } = await db
      .prepare(
        `SELECT g.id, g.title, g.slug, g.author_name, g.user_id, g.status, g.created_at, g.updated_at,
          LENGTH(g.content) AS content_length
         FROM guides g
         WHERE g.status = ?
         ORDER BY g.created_at DESC`
      )
      .bind(status)
      .all();

    const items = results.map(row => ({
      id: row.id,
      title: row.title || '',
      slug: row.slug,
      authorName: row.author_name || '',
      userId: row.user_id,
      status: row.status,
      contentLength: row.content_length || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return successResponse(`Guides with status '${status}'`, { items });

  } catch (error) {
    console.error('Admin list guides error:', error.message);
    return errorResponse('Failed to list guides.', 500);
  }
}

export async function onRequestDelete(context) {
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
      .prepare('SELECT id, title FROM guides WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Guide not found.');
    }

    // Delete votes first (foreign key)
    await db.prepare('DELETE FROM guide_votes WHERE guide_id = ?').bind(data.id).run();
    await db.prepare('DELETE FROM guides WHERE id = ?').bind(data.id).run();

    return successResponse(`Guide #${data.id} ("${existing.title}") has been permanently deleted.`);

  } catch (error) {
    console.error('Admin delete guide error:', error.message);
    return errorResponse('Failed to delete guide.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'DELETE', 'OPTIONS']);
}
