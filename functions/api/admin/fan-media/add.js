/**
 * POST /api/admin/fan-media/add — Manually add fan media
 *
 * Request body (JSON):
 *   { type (required), title (required), url (required),
 *     description?, authorName (required),
 *     userId? (default 0 for admin-created),
 *     status? (default 'approved' for admin-created) }
 *
 * Admin-created fan media defaults to 'approved' status.
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeText,
  requireAdmin,
  adminPreflightResponse,
  validateUrlScheme,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    // Type (required, 'art'/'video'/'music')
    if (!data.type || !['art', 'video', 'music'].includes(data.type)) {
      return errorResponse('Type is required and must be art, video, or music.');
    }

    // Title (required, 1-200 chars)
    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    // URL (required, 1-2000 chars, must be https:// or http://)
    const urlResult = validateField(data.url, 2000, 'URL');
    if (!urlResult.valid) return errorResponse(urlResult.error);
    const safeUrl = validateUrlScheme(urlResult.value);
    if (!safeUrl) return errorResponse('URL must start with https:// or http://');

    // Description (optional, 1-500 chars)
    const descResult = validateOptionalField(data.description, 500, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    // Author name (required)
    const authorResult = validateField(data.authorName, 50, 'Author name');
    if (!authorResult.valid) return errorResponse(authorResult.error);

    // userId (optional, default 0 for admin-created)
    const userId = (data.userId !== undefined && Number.isInteger(data.userId)) ? data.userId : 0;

    // Status (optional, default 'approved' for admin-created)
    const status = data.status && ['pending', 'approved', 'rejected'].includes(data.status) ? data.status : 'approved';

    // Insert the fan media
    const result = await db
      .prepare(
        `INSERT INTO fan_media (user_id, type, title, description, url, author_name, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        data.type,
        sanitizeText(titleResult.value),
        descResult.value ? sanitizeText(descResult.value) : null,
        safeUrl,
        sanitizeText(authorResult.value),
        status,
      )
      .run();

    const newId = result.meta.last_row_id;

    return successResponse('Fan media added successfully.', { id: newId });

  } catch (error) {
    console.error('Admin add fan media error:', error.message);
    return errorResponse('Failed to add fan media.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
