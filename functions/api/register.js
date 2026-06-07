/**
 * POST /api/register — Member Registration
 * 
 * Validates form data, verifies hCaptcha, stores profile picture as base64
 * in D1, and saves the member record with "pending" status.
 * 
 * Request body (JSON):
 *   { memberName, trainerID, favoriteUma, bio, profilePicture, fileName, mimeType, hCaptchaToken }
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateTrainerId,
  sanitizeText,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from '../_shared/utils.js';

// Maximum JSON body size: 10MB (profile pictures up to 5MB + overhead)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

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

    // --- Validate Text Fields ---
    const nameResult = validateField(data.memberName, 50, 'Display Name');
    if (!nameResult.valid) return errorResponse(nameResult.error);

    const trainerResult = validateTrainerId(data.trainerID);
    if (!trainerResult.valid) return errorResponse(trainerResult.error);

    const favUmaResult = validateField(data.favoriteUma, 50, 'Favorite Umamusume');
    if (!favUmaResult.valid) return errorResponse(favUmaResult.error);

    const bioResult = validateField(data.bio, 500, 'Bio');
    if (!bioResult.valid) return errorResponse(bioResult.error);

    // --- Check for duplicate Trainer ID ---
    const existing = await db
      .prepare('SELECT id FROM members WHERE trainer_id = ?')
      .bind(trainerResult.value)
      .first();
    if (existing) {
      return errorResponse('This Trainer ID is already registered.');
    }

    // --- Validate Profile Picture ---
    if (!data.profilePicture || !data.mimeType) {
      return errorResponse('Profile picture is required.');
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      return errorResponse('Invalid image format. Allowed: PNG, JPEG, GIF, WebP.');
    }

    // Extract base64 data (strip data URL prefix if present)
    let base64Data;
    try {
      base64Data = data.profilePicture.includes(',')
        ? data.profilePicture.split(',')[1]
        : data.profilePicture;

      // Validate that it's real base64 by decoding
      const decoded = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      if (decoded.length > MAX_IMAGE_SIZE_BYTES) {
        return errorResponse('Image file too large. Maximum size is 5MB.');
      }
    } catch {
      return errorResponse('Invalid image data.');
    }

    // --- Sanitize and Save Member to D1 ---
    // Sanitize once on write — data will be served as-is on read
    const sanitizedName = sanitizeText(nameResult.value);
    const sanitizedFavUma = sanitizeText(favUmaResult.value);
    const sanitizedBio = sanitizeText(bioResult.value);

    try {
      await db
        .prepare(
          `INSERT INTO members (name, trainer_id, favorite_uma, bio, profile_picture_data, profile_picture_mime, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        )
        .bind(sanitizedName, trainerResult.value, sanitizedFavUma, sanitizedBio, base64Data, data.mimeType)
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      return errorResponse('Failed to save registration. Please try again.');
    }

    return successResponse('Registration submitted successfully! Please wait for an admin to approve your entry.');

  } catch (error) {
    console.error('Registration error:', error.message);
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
