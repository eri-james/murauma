/**
 * POST /api/admin/hero-banner/update — Update a hero banner by ID
 *
 * Request body (JSON):
 *   { id, title?, description?, linkUrl?, mediaType?, mediaUrl?, isActive? }
 *
 * When isActive is set to true, all other banners are deactivated.
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  requireAdmin,
  adminPreflightResponse,
  normalizeYouTubeUrl,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid banner ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id FROM hero_banner WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Hero banner not found.');
    }

    const updates = [];
    const values = [];

    if (data.title !== undefined) {
      const result = validateField(data.title, 200, 'Title');
      if (!result.valid) return errorResponse(result.error);
      updates.push('title = ?');
      values.push(result.value);
    }

    if (data.description !== undefined) {
      const result = validateOptionalField(data.description, 500, 'Description');
      if (!result.valid) return errorResponse(result.error);
      updates.push('description = ?');
      values.push(result.value || '');
    }

    if (data.linkUrl !== undefined) {
      const result = validateOptionalField(data.linkUrl, 2000, 'Link URL');
      if (!result.valid) return errorResponse(result.error);
      updates.push('link_url = ?');
      values.push(result.value || '');
    }

    if (data.mediaType !== undefined) {
      if (!['youtube', 'image'].includes(data.mediaType)) {
        return errorResponse('Media type must be youtube or image.');
      }
      updates.push('media_type = ?');
      values.push(data.mediaType);
    }

    if (data.mediaUrl !== undefined) {
      const result = validateOptionalField(data.mediaUrl, 2000, 'Media URL');
      if (!result.valid) return errorResponse(result.error);

      // Normalize YouTube URLs to embed format
      let mediaUrlValue = result.value || '';
      // Determine the media type for this update (could be new or existing)
      const effectiveMediaType = data.mediaType !== undefined
        ? (['youtube', 'image'].includes(data.mediaType) ? data.mediaType : 'youtube')
        : 'youtube'; // default assumption when only URL changes
      if (effectiveMediaType === 'youtube' && mediaUrlValue) {
        mediaUrlValue = normalizeYouTubeUrl(mediaUrlValue);
      }

      updates.push('media_url = ?');
      values.push(mediaUrlValue);
    }

    if (data.isActive !== undefined) {
      const isActive = data.isActive === true || data.isActive === 1 ? 1 : 0;
      // If activating this banner, deactivate all others first
      if (isActive) {
        await db.prepare('UPDATE hero_banner SET is_active = 0 WHERE is_active = 1').run();
      }
      updates.push('is_active = ?');
      values.push(isActive);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update.');
    }

    updates.push("updated_at = datetime('now')");
    values.push(data.id);

    await db
      .prepare(`UPDATE hero_banner SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse(`Hero banner #${data.id} updated successfully.`);
  } catch (error) {
    console.error('Admin update hero banner error:', error.message);
    return errorResponse('Failed to update hero banner.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
