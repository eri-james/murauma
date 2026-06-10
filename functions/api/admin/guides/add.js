/**
 * POST /api/admin/guides/add — Manually add a guide
 *
 * Request body (JSON):
 *   { title (required), content (required), authorName (required),
 *     userId? (default 0 for admin-created),
 *     status? (default 'approved' for admin-created) }
 *
 * Generates slug from title. Appends number if slug is duplicate.
 * Admin-created guides default to 'approved' status.
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

    // Title (required, 1-200 chars)
    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    // Content (required, rich HTML)
    if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) {
      return errorResponse('Content is required.');
    }
    if (data.content.length > 500000) {
      return errorResponse('Content must be 500KB or less.');
    }
    const sanitizedContent = sanitizeRichHtml(data.content);
    if (!sanitizedContent.trim()) {
      return errorResponse('Content cannot be empty after sanitization.');
    }

    // Author name (required)
    const authorResult = validateField(data.authorName, 50, 'Author name');
    if (!authorResult.valid) return errorResponse(authorResult.error);

    // userId (optional, default 0 for admin-created)
    const userId = (data.userId !== undefined && Number.isInteger(data.userId)) ? data.userId : 0;

    // Status (optional, default 'approved' for admin-created)
    const status = data.status && ['pending', 'approved', 'rejected'].includes(data.status) ? data.status : 'approved';

    // Generate slug from title
    let slug = generateSlug(titleResult.value);
    if (!slug) {
      slug = 'untitled-guide';
    }

    // Check slug uniqueness and append number if duplicate
    const slugCheck = await db
      .prepare('SELECT id FROM guides WHERE slug = ?')
      .bind(slug)
      .first();

    if (slugCheck) {
      let suffix = 1;
      let candidateSlug = `${slug}-${suffix}`;
      while (await db.prepare('SELECT id FROM guides WHERE slug = ?').bind(candidateSlug).first()) {
        suffix++;
        candidateSlug = `${slug}-${suffix}`;
      }
      slug = candidateSlug;
    }

    // Insert the guide
    const result = await db
      .prepare(
        `INSERT INTO guides (user_id, title, slug, content, author_name, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        titleResult.value,
        slug,
        sanitizedContent,
        authorResult.value,
        status,
      )
      .run();

    const newId = result.meta.last_row_id;

    return successResponse('Guide added successfully.', { id: newId, slug });

  } catch (error) {
    console.error('Admin add guide error:', error.message);
    return errorResponse('Failed to add guide.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
