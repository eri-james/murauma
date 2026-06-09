/**
 * Admin API — Event Management (List, Create, Delete)
 *
 * GET    /api/admin/events?status=published  — List events
 * POST   /api/admin/events                   — Create a new event
 * DELETE /api/admin/events                   — Delete an event by ID
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeRichHtml,
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
      query = `SELECT id, title, slug, description, image_url, start_date, end_date, status, created_at, updated_at,
                LENGTH(content) AS content_length
               FROM events WHERE status = ? ORDER BY start_date DESC`;
      params = [status];
    } else {
      query = `SELECT id, title, slug, description, image_url, start_date, end_date, status, created_at, updated_at,
                LENGTH(content) AS content_length
               FROM events ORDER BY start_date DESC`;
      params = [];
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const items = results.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description || '',
      imageUrl: row.image_url || '',
      startDate: row.start_date,
      endDate: row.end_date || '',
      status: row.status,
      contentLength: row.content_length || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return successResponse('Events loaded.', { items });
  } catch (error) {
    console.error('Admin list events error:', error.message);
    return errorResponse('Failed to list events.', 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    const startDateResult = validateField(data.startDate, 50, 'Start date');
    if (!startDateResult.valid) return errorResponse(startDateResult.error);

    const descResult = validateOptionalField(data.description, 2000, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    const endDateResult = validateOptionalField(data.endDate, 50, 'End date');
    if (!endDateResult.valid) return errorResponse(endDateResult.error);

    const imageUrlResult = validateOptionalField(data.imageUrl, 2000, 'Image URL');
    if (!imageUrlResult.valid) return errorResponse(imageUrlResult.error);

    // Content is rich HTML (optional on create)
    let sanitizedContent = '';
    if (data.content && typeof data.content === 'string') {
      if (data.content.length > 500000) {
        return errorResponse('Content must be 500KB or less.');
      }
      sanitizedContent = sanitizeRichHtml(data.content);
    }

    // Generate unique slug
    let slug = data.slug ? data.slug.trim().toLowerCase() : generateSlug(titleResult.value);
    if (!slug || slug.length === 0) {
      slug = `event-${Date.now()}`;
    }

    const existing = await db.prepare('SELECT id FROM events WHERE slug = ?').bind(slug).first();
    if (existing) {
      let suffix = 2;
      let newSlug = `${slug}-${suffix}`;
      while (await db.prepare('SELECT id FROM events WHERE slug = ?').bind(newSlug).first()) {
        suffix++;
        newSlug = `${slug}-${suffix}`;
      }
      slug = newSlug;
    }

    const status = data.status === 'draft' ? 'draft' : 'published';

    await db
      .prepare(
        `INSERT INTO events (title, slug, description, content, image_url, start_date, end_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        titleResult.value,
        slug,
        descResult.value || '',
        sanitizedContent,
        imageUrlResult.value || null,
        startDateResult.value,
        endDateResult.value || null,
        status
      )
      .run();

    return successResponse('Event created successfully.', { slug });
  } catch (error) {
    console.error('Admin create event error:', error.message);
    return errorResponse('Failed to create event.', 500);
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
      return errorResponse('Valid event ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM events WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Event not found.');
    }

    await db.prepare('DELETE FROM events WHERE id = ?').bind(data.id).run();

    return successResponse(`Event #${data.id} ("${existing.title}") has been deleted.`);
  } catch (error) {
    console.error('Admin delete event error:', error.message);
    return errorResponse('Failed to delete event.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'DELETE', 'OPTIONS']);
}
