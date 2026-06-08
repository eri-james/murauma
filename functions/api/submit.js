/**
 * POST /api/submit — Writing Submission (Auth-based)
 * 
 * Validates form data, verifies hCaptcha, uses the authenticated
 * user's identity to submit the writing under their name.
 * Falls back to trainer_id-based submission for backward compatibility.
 * 
 * Request body (JSON):
 *   { trainerID (legacy), title, content, hCaptchaToken }
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateTrainerId,
  sanitizeHtml,
  sanitizeText,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
  getOptionalAuth,
} from '../_shared/utils.js';

// Maximum JSON body size: 100KB (writings up to 50KB + overhead)
const MAX_BODY_SIZE = 100 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    // --- Enforce body size limit ---
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      return errorResponse('Request body too large.', 413);
    }

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
    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    const contentResult = validateField(data.content, 50000, 'Content');
    if (!contentResult.valid) return errorResponse(contentResult.error);

    // --- Identify the author ---
    // Try authenticated user first
    const authUser = await getOptionalAuth(request, env);
    let authorId = null;
    let authorName = null;
    let authorTrainerId = null;

    if (authUser && authUser.userId > 0) {
      // Authenticated user — look up their member record
      const member = await db
        .prepare('SELECT id, name, trainer_id, status FROM members WHERE id = ?')
        .bind(authUser.userId)
        .first();

      if (!member) {
        return errorResponse('Member account not found.');
      }

      if (member.status !== 'approved') {
        return errorResponse('Your membership has not been approved yet. Please wait for admin approval.');
      }

      authorId = member.id;
      authorName = member.name;
      authorTrainerId = member.trainer_id;
    } else {
      // Legacy fallback: trainer_id-based submission
      const trainerResult = validateTrainerId(data.trainerID);
      if (!trainerResult.valid || !trainerResult.value) {
        return errorResponse('Please log in to submit writings.');
      }

      const member = await db
        .prepare('SELECT id, name, status FROM members WHERE trainer_id = ?')
        .bind(trainerResult.value)
        .first();

      if (!member) {
        return errorResponse('Trainer ID not found. You must be a registered member to submit writings.');
      }

      if (member.status !== 'approved') {
        return errorResponse('Your membership has not been approved yet. Please wait for admin approval.');
      }

      authorId = member.id;
      authorName = member.name;
      authorTrainerId = trainerResult.value;
    }

    // --- Sanitize content once on write ---
    const sanitizedTitle = sanitizeText(titleResult.value);
    const sanitizedContent = sanitizeHtml(contentResult.value);

    // --- Save Writing to D1 (status: pending — requires admin approval) ---
    try {
      await db
        .prepare(
          `INSERT INTO writings (title, author_name, trainer_id, user_id, content, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`
        )
        .bind(sanitizedTitle, authorName, authorTrainerId, authorId, sanitizedContent)
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      return errorResponse('Failed to save writing. Please try again.');
    }

    return successResponse('Writing submitted successfully! It will be reviewed by an admin before appearing in the Writings Library.');

  } catch (error) {
    console.error('Writing submission error:', error.message);
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
