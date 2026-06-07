/**
 * POST /api/submit — Writing Submission
 * 
 * Validates form data, verifies hCaptcha, looks up the author's name
 * from the members table by trainer ID, and saves the writing to D1.
 * 
 * Request body (JSON):
 *   { formType, trainerID, title, content, hCaptchaToken }
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
} from '../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
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
    const trainerResult = validateTrainerId(data.trainerID);
    if (!trainerResult.valid) return errorResponse(trainerResult.error);

    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    const contentResult = validateField(data.content, 50000, 'Content');
    if (!contentResult.valid) return errorResponse(contentResult.error);

    // --- Look up author name from members table ---
    const member = await db
      .prepare('SELECT name, status FROM members WHERE trainer_id = ?')
      .bind(trainerResult.value)
      .first();

    if (!member) {
      return errorResponse('Trainer ID not found. You must be a registered member to submit writings.');
    }

    if (member.status !== 'approved') {
      return errorResponse('Your membership has not been approved yet. Please wait for admin approval.');
    }

    // --- Sanitize content (Markdown may contain raw HTML) ---
    const sanitizedTitle = sanitizeHtml(titleResult.value);
    const sanitizedContent = sanitizeHtml(contentResult.value);
    const authorName = sanitizeText(member.name);

    // --- Save Writing to D1 ---
    try {
      await db
        .prepare(
          `INSERT INTO writings (title, author_name, trainer_id, content)
           VALUES (?, ?, ?, ?)`
        )
        .bind(sanitizedTitle, authorName, trainerResult.value, sanitizedContent)
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      return errorResponse('Failed to save writing. Please try again.');
    }

    return successResponse('Writing submitted successfully! It will appear in the Writings Library shortly.');

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
