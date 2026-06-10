/**
 * Admin API — Hero Banner Management (List, Create, Delete)
 *
 * GET    /api/admin/hero-banner           — List all banners
 * POST   /api/admin/hero-banner           — Create a new banner
 * DELETE /api/admin/hero-banner           — Delete a banner by ID
 *
 * When creating or updating a banner with is_active = true,
 * all other banners are deactivated so only one is active.
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

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const { results } = await db
      .prepare(
        `SELECT id, title, description, link_url, media_type, media_url, is_active, created_at, updated_at
         FROM hero_banner
         ORDER BY is_active DESC, created_at DESC`
      )
      .all();

    const items = results.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      linkUrl: row.link_url || '',
      mediaType: row.media_type,
      mediaUrl: row.media_url || '',
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return successResponse('Hero banners loaded.', { items });
  } catch (error) {
    console.error('Admin list hero banners error:', error.message);
    return errorResponse('Failed to list hero banners.', 500);
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

    const descResult = validateOptionalField(data.description, 500, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    const linkUrlResult = validateOptionalField(data.linkUrl, 2000, 'Link URL');
    if (!linkUrlResult.valid) return errorResponse(linkUrlResult.error);

    const mediaUrlResult = validateOptionalField(data.mediaUrl, 2000, 'Media URL');
    if (!mediaUrlResult.valid) return errorResponse(mediaUrlResult.error);

    const mediaType = ['youtube', 'image'].includes(data.mediaType) ? data.mediaType : 'youtube';

    // Normalize YouTube URLs to embed format (handles youtu.be, watch?v=, etc.)
    let mediaUrlValue = mediaUrlResult.value || '';
    if (mediaType === 'youtube' && mediaUrlValue) {
      mediaUrlValue = normalizeYouTubeUrl(mediaUrlValue);
    }

    const isActive = data.isActive === true || data.isActive === 1 ? 1 : 0;

    // If this banner is active, deactivate all others
    if (isActive) {
      await db.prepare('UPDATE hero_banner SET is_active = 0 WHERE is_active = 1').run();
    }

    await db
      .prepare(
        `INSERT INTO hero_banner (title, description, link_url, media_type, media_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        titleResult.value,
        descResult.value || '',
        linkUrlResult.value || '',
        mediaType,
        mediaUrlValue,
        isActive
      )
      .run();

    return successResponse('Hero banner created successfully.');
  } catch (error) {
    console.error('Admin create hero banner error:', error.message);
    return errorResponse('Failed to create hero banner.', 500);
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
      return errorResponse('Valid banner ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM hero_banner WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Hero banner not found.');
    }

    await db.prepare('DELETE FROM hero_banner WHERE id = ?').bind(data.id).run();

    return successResponse(`Hero banner #${data.id} ("${existing.title}") has been deleted.`);
  } catch (error) {
    console.error('Admin delete hero banner error:', error.message);
    return errorResponse('Failed to delete hero banner.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'DELETE', 'OPTIONS']);
}
