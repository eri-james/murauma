/**
 * Admin API — Weekly Race Management (List, Create, Delete)
 *
 * GET    /api/admin/weekly-races?status=published  — List weekly races
 * POST   /api/admin/weekly-races                   — Create a new weekly race
 * DELETE /api/admin/weekly-races                   — Delete a weekly race by ID
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeText,
  generateSlug,
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
    const status = url.searchParams.get('status') || 'all';

    let query, params;
    if (status !== 'all' && ['draft', 'published'].includes(status)) {
      query = `SELECT id, title, track, deadline, description, image_url, is_active, status, created_at, updated_at
               FROM weekly_races WHERE status = ? ORDER BY created_at DESC`;
      params = [status];
    } else {
      query = `SELECT id, title, track, deadline, description, image_url, is_active, status, created_at, updated_at
               FROM weekly_races ORDER BY created_at DESC`;
      params = [];
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const items = results.map(row => ({
      id: row.id,
      title: row.title,
      track: row.track,
      deadline: row.deadline,
      description: row.description || '',
      imageUrl: row.image_url || '',
      isActive: row.is_active === 1,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return successResponse('Weekly races loaded.', { items });
  } catch (error) {
    console.error('Admin list weekly races error:', error.message);
    return errorResponse('Failed to list weekly races.', 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    // Validate required fields
    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    const trackResult = validateField(data.track, 200, 'Track');
    if (!trackResult.valid) return errorResponse(trackResult.error);

    const deadlineResult = validateField(data.deadline, 100, 'Deadline');
    if (!deadlineResult.valid) return errorResponse(deadlineResult.error);

    const descResult = validateOptionalField(data.description, 2000, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    const imageUrlResult = validateOptionalField(data.imageUrl, 2000, 'Image URL');
    if (!imageUrlResult.valid) return errorResponse(imageUrlResult.error);

    const isActive = data.isActive === false ? 0 : 1;
    const status = data.status === 'draft' ? 'draft' : 'published';

    await db
      .prepare(
        `INSERT INTO weekly_races (title, track, deadline, description, image_url, is_active, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        sanitizeText(titleResult.value),
        sanitizeText(trackResult.value),
        sanitizeText(deadlineResult.value),
        descResult.value ? sanitizeText(descResult.value) : '',
        imageUrlResult.value || null,
        isActive,
        status
      )
      .run();

    return successResponse('Weekly race created successfully.');
  } catch (error) {
    console.error('Admin create weekly race error:', error.message);
    return errorResponse('Failed to create weekly race.', 500);
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
      return errorResponse('Valid weekly race ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM weekly_races WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Weekly race not found.');
    }

    await db.prepare('DELETE FROM weekly_races WHERE id = ?').bind(data.id).run();

    return successResponse(`Weekly race #${data.id} ("${existing.title}") has been deleted.`);
  } catch (error) {
    console.error('Admin delete weekly race error:', error.message);
    return errorResponse('Failed to delete weekly race.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'DELETE', 'OPTIONS']);
}
