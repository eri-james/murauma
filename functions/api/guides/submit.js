/**
 * POST /api/guides/submit — Submit a Guide (Auth required)
 *
 * Members write guides using a rich text editor (Quill.js).
 * Content is HTML, sanitized server-side with sanitizeRichHtml().
 * Admin approval required before appearing publicly.
 *
 * Request body (JSON):
 *   { title, content (HTML), hCaptchaToken }
 */
import {
  errorResponse,
  successResponse,
  validateField,
  sanitizeText,
  sanitizeRichHtml,
  generateSlug,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
  requireAuth,
} from '../../_shared/utils.js';

const MAX_TITLE_LENGTH = 200;
const MAX_GUIDE_CONTENT_LENGTH = 500000; // 500KB — allows rich HTML with embedded images
const MAX_BODY_SIZE = 600 * 1024; // 600KB body limit

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    // --- Enforce body size limit ---
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      return errorResponse('Request body too large.', 413);
    }

    // --- Require Authentication ---
    const { user, error: authError } = await requireAuth(request, env);
    if (authError) return authError;

    // --- Parse request body ---
    const data = await request.json();

    // --- Rate Limiting ---
    const clientKey = getClientKey(request);
    const allowed = await checkRateLimit(db, clientKey);
    if (!allowed) {
      return errorResponse('Rate limit exceeded. Please wait a few minutes before trying again.', 429);
    }

    // --- hCaptcha Verification ---
    if (!data.hCaptchaToken || !(await verifyHcaptcha(data.hCaptchaToken, env.HCAPTCHA_SECRET))) {
      return errorResponse('CAPTCHA verification failed. Please try again.');
    }

    // --- Validate Fields ---
    const titleResult = validateField(data.title, MAX_TITLE_LENGTH, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) {
      return errorResponse('Guide content is required.');
    }
    if (data.content.length > MAX_GUIDE_CONTENT_LENGTH) {
      return errorResponse(`Guide content must be ${MAX_GUIDE_CONTENT_LENGTH / 1000}KB or less.`);
    }

    // --- Verify member exists and is approved ---
    const member = await db
      .prepare('SELECT id, name, status FROM members WHERE id = ?')
      .bind(user.userId)
      .first();

    if (!member) {
      return errorResponse('Member account not found.');
    }
    if (member.status !== 'approved') {
      return errorResponse('Your membership has not been approved yet. Please wait for admin approval.');
    }

    // --- Sanitize content ---
    const sanitizedTitle = sanitizeText(titleResult.value);
    const sanitizedContent = sanitizeRichHtml(data.content);
    const authorName = member.name || '';

    // --- Generate unique slug ---
    let slug = generateSlug(titleResult.value);
    if (!slug || slug.length === 0) {
      // Fallback for titles with no ASCII characters
      slug = `guide-${Date.now()}`;
    }

    // Check slug uniqueness — append number if taken
    const existing = await db
      .prepare('SELECT id FROM guides WHERE slug = ?')
      .bind(slug)
      .first();

    if (existing) {
      let suffix = 2;
      let newSlug = `${slug}-${suffix}`;
      while (await db.prepare('SELECT id FROM guides WHERE slug = ?').bind(newSlug).first()) {
        suffix++;
        newSlug = `${slug}-${suffix}`;
      }
      slug = newSlug;
    }

    // --- Save to D1 ---
    try {
      await db
        .prepare(
          `INSERT INTO guides (user_id, title, slug, content, author_name, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`
        )
        .bind(user.userId, sanitizedTitle, slug, sanitizedContent, authorName)
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      return errorResponse('Failed to save guide. Please try again.');
    }

    return successResponse('Guide submitted successfully! It will be reviewed by an admin before appearing publicly.', { slug });

  } catch (error) {
    console.error('Guide submission error:', error.message);
    return errorResponse('An internal error occurred.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
