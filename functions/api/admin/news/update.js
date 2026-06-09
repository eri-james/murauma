/**
 * POST /api/admin/news/update — Update a news post by ID
 *
 * Request body (JSON):
 *   { id, title?, slug?, category?, description?, content?, imageUrl?, status? }
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeRichHtml,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
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
      .prepare('SELECT id, slug FROM news WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('News post not found.');
    }

    const updates = [];
    const values = [];

    if (data.title !== undefined) {
      const result = validateField(data.title, 200, 'Title');
      if (!result.valid) return errorResponse(result.error);
      updates.push('title = ?');
      values.push(result.value);
    }

    if (data.slug !== undefined) {
      let newSlug = data.slug.trim().toLowerCase();
      if (!newSlug) return errorResponse('Slug cannot be empty.');
      const slugCheck = await db
        .prepare('SELECT id FROM news WHERE slug = ? AND id != ?')
        .bind(newSlug, data.id)
        .first();
      if (slugCheck) return errorResponse('Slug is already taken.');
      updates.push('slug = ?');
      values.push(newSlug);
    }

    if (data.category !== undefined) {
      if (!['event', 'community', 'update'].includes(data.category)) {
        return errorResponse('Category must be event, community, or update.');
      }
      updates.push('category = ?');
      values.push(data.category);
    }

    if (data.description !== undefined) {
      const result = validateOptionalField(data.description, 2000, 'Description');
      if (!result.valid) return errorResponse(result.error);
      updates.push('description = ?');
      values.push(result.value || '');
    }

    if (data.content !== undefined) {
      if (data.content && data.content.length > 500000) {
        return errorResponse('Content must be 500KB or less.');
      }
      updates.push('content = ?');
      values.push(sanitizeRichHtml(data.content || ''));
    }

    if (data.imageUrl !== undefined) {
      const result = validateOptionalField(data.imageUrl, 2000, 'Image URL');
      if (!result.valid) return errorResponse(result.error);
      updates.push('image_url = ?');
      values.push(result.value || null);
    }

    if (data.status !== undefined) {
      if (!['draft', 'published'].includes(data.status)) {
        return errorResponse('Status must be draft or published.');
      }
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update.');
    }

    updates.push("updated_at = datetime('now')");
    values.push(data.id);

    await db
      .prepare(`UPDATE news SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse(`News post #${data.id} updated successfully.`);
  } catch (error) {
    console.error('Admin update news error:', error.message);
    return errorResponse('Failed to update news post.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
