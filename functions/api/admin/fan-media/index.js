/**
 * Admin API — Fan Media Management (List + Delete)
 *
 * GET    /api/admin/fan-media?status=pending  — List fan media by status
 * DELETE /api/admin/fan-media                 — Delete a fan media entry by ID
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
    const type = url.searchParams.get('type'); // optional filter

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return errorResponse('Invalid status. Use: pending, approved, or rejected.');
    }

    let query;
    let params;

    if (type && ['art', 'video', 'music'].includes(type)) {
      query = `
        SELECT fm.id, fm.type, fm.title, fm.description, fm.url, fm.author_name, fm.user_id, fm.status, fm.created_at
        FROM fan_media fm
        WHERE fm.status = ? AND fm.type = ?
        ORDER BY fm.created_at DESC
      `;
      params = [status, type];
    } else {
      query = `
        SELECT fm.id, fm.type, fm.title, fm.description, fm.url, fm.author_name, fm.user_id, fm.status, fm.created_at
        FROM fan_media fm
        WHERE fm.status = ?
        ORDER BY fm.created_at DESC
      `;
      params = [status];
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const items = results.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title || '',
      description: row.description || '',
      url: row.url || '',
      authorName: row.author_name || '',
      userId: row.user_id,
      status: row.status,
      createdAt: row.created_at,
    }));

    return successResponse(`Fan media with status '${status}'`, { items });

  } catch (error) {
    console.error('Admin list fan media error:', error.message);
    return errorResponse('Failed to list fan media.', 500);
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
      return errorResponse('Valid fan media ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM fan_media WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Fan media entry not found.');
    }

    await db
      .prepare('DELETE FROM fan_media WHERE id = ?')
      .bind(data.id)
      .run();

    return successResponse(`Fan media #${data.id} ("${existing.title}") has been permanently deleted.`);

  } catch (error) {
    console.error('Admin delete fan media error:', error.message);
    return errorResponse('Failed to delete fan media.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'DELETE', 'OPTIONS']);
}
