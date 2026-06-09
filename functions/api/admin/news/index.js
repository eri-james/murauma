/**
 * Admin API — News Management (List, Create, Delete)
 *
 * GET    /api/admin/news?status=published  — List news
 * POST   /api/admin/news                   — Create a new news post
 * DELETE /api/admin/news                   — Delete a news post by ID
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
      query = `SELECT id, title, slug, category, description, image_url, status, created_at, updated_at,
                LENGTH(content) AS content_length
               FROM news WHERE status = ? ORDER BY created_at DESC`;
      params = [status];
    } else {
      query = `SELECT id, title, slug, category, description, image_url, status, created_at, updated_at,
                LENGTH(content) AS content_length
               FROM news ORDER BY created_at DESC`;
      params = [];
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const items = results.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      category: row.category,
      description: row.description || '',
      imageUrl: row.image_url || '',
      status: row.status,
      contentLength: row.content_length || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return successResponse('News loaded.', { items });
  } catch (error) {
    console.error('Admin list news error:', error.message);
    return errorResponse('Failed to list news.', 500);
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

    const descResult = validateOptionalField(data.description, 2000, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    const imageUrlResult = validateOptionalField(data.imageUrl, 2000, 'Image URL');
    if (!imageUrlResult.valid) return errorResponse(imageUrlResult.error);

    const category = ['event', 'community', 'update'].includes(data.category) ? data.category : 'community';

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
      slug = `news-${Date.now()}`;
    }

    const existing = await db.prepare('SELECT id FROM news WHERE slug = ?').bind(slug).first();
    if (existing) {
      let suffix = 2;
      let newSlug = `${slug}-${suffix}`;
      while (await db.prepare('SELECT id FROM news WHERE slug = ?').bind(newSlug).first()) {
        suffix++;
        newSlug = `${slug}-${suffix}`;
      }
      slug = newSlug;
    }

    const status = data.status === 'draft' ? 'draft' : 'published';

    await db
      .prepare(
        `INSERT INTO news (title, slug, category, description, content, image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        titleResult.value,
        slug,
        category,
        descResult.value || '',
        sanitizedContent,
        imageUrlResult.value || null,
        status
      )
      .run();

    return successResponse('News post created successfully.', { slug });
  } catch (error) {
    console.error('Admin create news error:', error.message);
    return errorResponse('Failed to create news post.', 500);
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
      return errorResponse('Valid news ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM news WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('News post not found.');
    }

    await db.prepare('DELETE FROM news WHERE id = ?').bind(data.id).run();

    return successResponse(`News post #${data.id} ("${existing.title}") has been deleted.`);
  } catch (error) {
    console.error('Admin delete news error:', error.message);
    return errorResponse('Failed to delete news post.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'DELETE', 'OPTIONS']);
}
