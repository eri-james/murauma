/**
 * POST /api/register — Member Registration
 * 
 * Validates form data, verifies hCaptcha, uploads profile picture to R2,
 * and saves the member record to D1 with "pending" status.
 * 
 * Request body (JSON):
 *   { formType, memberName, trainerID, favoriteUma, bio, profilePicture, fileName, mimeType, hCaptchaToken }
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const bucket = env.BUCKET;

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

    // --- Validate and Upload Profile Picture to R2 ---
    if (!data.profilePicture || !data.fileName || !data.mimeType) {
      return errorResponse('Profile picture is required.');
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      return errorResponse('Invalid image format. Allowed: PNG, JPEG, GIF, WebP.');
    }

    // Decode base64 data
    let imageBytes;
    try {
      const base64Data = data.profilePicture.includes(',')
        ? data.profilePicture.split(',')[1]  // Strip data URL prefix
        : data.profilePicture;
      imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    } catch {
      return errorResponse('Invalid image data.');
    }

    if (imageBytes.length > MAX_IMAGE_SIZE_BYTES) {
      return errorResponse('Image file too large. Maximum size is 5MB.');
    }

    // Generate R2 key: profiles/{trainer_id}.{extension}
    const ext = data.mimeType.split('/')[1] || 'png';
    const r2Key = `profiles/${trainerResult.value}.${ext}`;

    try {
      await bucket.put(r2Key, imageBytes, {
        httpMetadata: { contentType: data.mimeType },
      });
    } catch (uploadError) {
      console.error('R2 upload error:', uploadError.message);
      return errorResponse('Failed to upload profile picture. Please try again.');
    }

    // --- Save Member to D1 ---
    const sanitizedName = sanitizeText(nameResult.value);
    const sanitizedFavUma = sanitizeText(favUmaResult.value);
    const sanitizedBio = sanitizeText(bioResult.value);

    try {
      await db
        .prepare(
          `INSERT INTO members (name, trainer_id, favorite_uma, bio, profile_picture_key, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`
        )
        .bind(sanitizedName, trainerResult.value, sanitizedFavUma, sanitizedBio, r2Key)
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      // Clean up the uploaded image if DB write fails
      await bucket.delete(r2Key);
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
