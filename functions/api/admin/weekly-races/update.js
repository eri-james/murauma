/**
 * POST /api/admin/weekly-races/update — Update a weekly race by ID
 *
 * Request body (JSON):
 *   { id, title?, track?, deadline?, description?, imageUrl?, isActive?, status? }
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

    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid weekly race ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id FROM weekly_races WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Weekly race not found.');
    }

    // Build dynamic UPDATE query
    const updates = [];
    const values = [];

    if (data.title !== undefined) {
      const result = validateField(data.title, 200, 'Title');
      if (!result.valid) return errorResponse(result.error);
      updates.push('title = ?');
      values.push(sanitizeText(result.value));
    }

    if (data.track !== undefined) {
      const result = validateField(data.track, 200, 'Track');
      if (!result.valid) return errorResponse(result.error);
      updates.push('track = ?');
      values.push(sanitizeText(result.value));
    }

    if (data.deadline !== undefined) {
      const result = validateField(data.deadline, 100, 'Deadline');
      if (!result.valid) return errorResponse(result.error);
      updates.push('deadline = ?');
      values.push(sanitizeText(result.value));
    }

    if (data.description !== undefined) {
      const result = validateOptionalField(data.description, 2000, 'Description');
      if (!result.valid) return errorResponse(result.error);
      updates.push('description = ?');
      values.push(result.value ? sanitizeText(result.value) : '');
    }

    if (data.imageUrl !== undefined) {
      const result = validateOptionalField(data.imageUrl, 2000, 'Image URL');
      if (!result.valid) return errorResponse(result.error);
      updates.push('image_url = ?');
      values.push(result.value || null);
    }

    if (data.isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(data.isActive === false ? 0 : 1);
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
      .prepare(`UPDATE weekly_races SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse(`Weekly race #${data.id} updated successfully.`);
  } catch (error) {
    console.error('Admin update weekly race error:', error.message);
    return errorResponse('Failed to update weekly race.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
