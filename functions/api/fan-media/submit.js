/**
 * POST /api/fan-media/submit — Submit Fan Media (Auth required)
 *
 * Members submit links to their fan content (art, video, music).
 * No file uploads — members share external links only.
 * Requires hCaptcha verification and authentication.
 *
 * Request body (JSON):
 *   { type, title, description (optional), url, hCaptchaToken }
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeText,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
  requireAuth,
} from '../../_shared/utils.js';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_URL_LENGTH = 2000;
const MAX_BODY_SIZE = 10 * 1024; // 10KB — just text fields, no files

const VALID_TYPES = ['art', 'video', 'music'];

/**
 * Basic URL validation: must start with https:// (or http:// for legacy).
 * Blocks dangerous schemes (javascript:, data:).
 */
function validateUrl(value) {
  if (!value || typeof value !== 'string') {
    return { valid: false, value: '', error: 'URL is required.' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, value: '', error: 'URL cannot be empty.' };
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { valid: false, value: '', error: `URL must be ${MAX_URL_LENGTH} characters or less.` };
  }
  // Must start with http:// or https://
  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, value: '', error: 'URL must start with http:// or https://.' };
  }
  // Block dangerous schemes
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return { valid: false, value: '', error: 'Dangerous URL scheme is not allowed.' };
  }
  return { valid: true, value: trimmed, error: null };
}

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

    // --- Validate Type ---
    if (!data.type || !VALID_TYPES.includes(data.type)) {
      return errorResponse(`Type must be one of: ${VALID_TYPES.join(', ')}.`);
    }

    // --- Validate Fields ---
    const titleResult = validateField(data.title, MAX_TITLE_LENGTH, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    const descResult = validateOptionalField(data.description, MAX_DESCRIPTION_LENGTH, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    const urlResult = validateUrl(data.url);
    if (!urlResult.valid) return errorResponse(urlResult.error);

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

    // --- Sanitize text fields ---
    const sanitizedTitle = sanitizeText(titleResult.value);
    const sanitizedDescription = descResult.value ? sanitizeText(descResult.value) : null;
    const sanitizedUrl = urlResult.value; // URLs are NOT sanitized with sanitizeText (would break them)
    const authorName = member.name || '';

    // --- Save to D1 ---
    try {
      await db
        .prepare(
          `INSERT INTO fan_media (user_id, type, title, description, url, author_name, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        )
        .bind(user.userId, data.type, sanitizedTitle, sanitizedDescription, sanitizedUrl, authorName)
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      return errorResponse('Failed to save submission. Please try again.');
    }

    return successResponse('Fan media submitted successfully! It will be reviewed by an admin before appearing publicly.');

  } catch (error) {
    console.error('Fan media submission error:', error.message);
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
