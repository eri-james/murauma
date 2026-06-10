/**
 * POST /api/admin/guides/update — Update guide fields
 *
 * Request body (JSON):
 *   { id (required), title?, content?, status? }
 *
 * Only updates fields that are provided.
 * If title changes, regenerates slug with generateSlug().
 * Updates updated_at timestamp.
 */
import {
  errorResponse,
  successResponse,
  validateField,
  sanitizeRichHtml,
  generateSlug,
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

    // Validate guide ID
    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid guide ID (integer) is required.');
    }

    // Check guide exists
    const existing = await db
      .prepare('SELECT id, slug FROM guides WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Guide not found.');
    }

    const updates = [];
    const values = [];

    // Title (optional, 1-200 chars)
    if (data.title !== undefined) {
      const result = validateField(data.title, 200, 'Title');
      if (!result.valid) return errorResponse(result.error);
      updates.push('title = ?');
      values.push(result.value);

      // Regenerate slug from new title
      let newSlug = generateSlug(result.value);

      // Check slug uniqueness (exclude current guide)
      let slugCheck = await db
        .prepare('SELECT id FROM guides WHERE slug = ? AND id != ?')
        .bind(newSlug, data.id)
        .first();

      // Append number if duplicate
      if (slugCheck) {
        let suffix = 1;
        let candidateSlug = `${newSlug}-${suffix}`;
        while (await db.prepare('SELECT id FROM guides WHERE slug = ? AND id != ?').bind(candidateSlug, data.id).first()) {
          suffix++;
          candidateSlug = `${newSlug}-${suffix}`;
        }
        newSlug = candidateSlug;
      }

      updates.push('slug = ?');
      values.push(newSlug);
    }

    // Content (optional, rich HTML)
    if (data.content !== undefined) {
      if (data.content && data.content.length > 500000) {
        return errorResponse('Content must be 500KB or less.');
      }
      updates.push('content = ?');
      values.push(sanitizeRichHtml(data.content || ''));
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

    // Always update updated_at
    updates.push("updated_at = datetime('now')");
    values.push(data.id);

    await db
      .prepare(`UPDATE guides SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse(`Guide #${data.id} updated successfully.`);

  } catch (error) {
    console.error('Admin update guide error:', error.message);
    return errorResponse('Failed to update guide.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
