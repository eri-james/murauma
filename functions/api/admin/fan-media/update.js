/**
 * POST /api/admin/fan-media/update — Update fan media fields
 *
 * Request body (JSON):
 *   { id (required), type?, title?, description?, url?, status? }
 *
 * Only updates fields that are provided.
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeText,
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

    // Validate fan media ID
    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid fan media ID (integer) is required.');
    }

    // Check fan media exists
    const existing = await db
      .prepare('SELECT id, title FROM fan_media WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Fan media entry not found.');
    }

    const updates = [];
    const values = [];

    // Type (optional, 'art'/'video'/'music')
    if (data.type !== undefined) {
      if (!['art', 'video', 'music'].includes(data.type)) {
        return errorResponse('Type must be art, video, or music.');
      }
      updates.push('type = ?');
      values.push(data.type);
    }

    // Title (optional, 1-200 chars)
    if (data.title !== undefined) {
      const result = validateField(data.title, 200, 'Title');
      if (!result.valid) return errorResponse(result.error);
      updates.push('title = ?');
      values.push(sanitizeText(result.value));
    }

    // Description (optional, 1-500 chars)
    if (data.description !== undefined) {
      const result = validateOptionalField(data.description, 500, 'Description');
      if (!result.valid) return errorResponse(result.error);
      updates.push('description = ?');
      values.push(result.value ? sanitizeText(result.value) : null);
    }

    // URL (optional, 1-2000 chars)
    if (data.url !== undefined) {
      const result = validateField(data.url, 2000, 'URL');
      if (!result.valid) return errorResponse(result.error);
      updates.push('url = ?');
      values.push(result.value);
    }

    // Status (optional, 'pending'/'approved'/'rejected')
    if (data.status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(data.status)) {
        return errorResponse('Status must be pending, approved, or rejected.');
      }
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update.');
    }

    values.push(data.id);

    await db
      .prepare(`UPDATE fan_media SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse(`Fan media #${data.id} updated successfully.`);

  } catch (error) {
    console.error('Admin update fan media error:', error.message);
    return errorResponse('Failed to update fan media.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
