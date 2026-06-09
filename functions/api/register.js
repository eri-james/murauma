/**
 * POST /api/register — Member Registration (with username/password)
 * 
 * Validates form data, verifies hCaptcha, hashes password with PBKDF2,
 * stores profile picture as base64 in D1, and saves the member with "pending" status.
 * 
 * Request body (JSON):
 *   { username, password, memberName, trainerID, favoriteUma, bio, profilePicture, mimeType, hCaptchaToken }
 * 
 * trainer_id, favorite_uma, bio, and profilePicture are now optional.
 * If no profile picture is provided, a default placeholder avatar is generated.
 * Users start with "pending" status — they can log in and edit their profile immediately,
 * but need admin approval before submitting fan content or guides.
 */
import {
  errorResponse,
  jsonResponse,
  validateField,
  validateOptionalField,
  validateTrainerId,
  validateUsername,
  validatePassword,
  sanitizeText,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
  hashPassword,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  sessionCookieValue,
  createJWT,
} from '../_shared/utils.js';

// Maximum JSON body size: 10MB (profile pictures up to 5MB + overhead)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Generates a default placeholder avatar as a base64-encoded PNG.
 * Uses the display name's first letter (or "?" if empty) on a colored background.
 * The background color is deterministically picked from a palette based on the name.
 *
 * @param {string} displayName — The sanitized display name (may contain HTML entities)
 * @returns {{ base64Data: string, mimeType: string }}
 */
function generateDefaultAvatar(displayName) {
  // Decode HTML entities to get a usable character for the initial
  const decodedName = displayName
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

  const initial = (decodedName || '?').charAt(0).toUpperCase();

  // Deterministic color from the name (simple hash)
  const palette = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#ef4444', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#2563eb', '#7c3aed', '#9333ea',
  ];
  let hash = 0;
  for (let i = 0; i < decodedName.length; i++) {
    hash = decodedName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const bgColor = palette[Math.abs(hash) % palette.length];

  // Generate a 256x256 SVG avatar
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="128" fill="${bgColor}"/>
  <text x="128" y="128" text-anchor="middle" dy=".35em" font-family="Inter, Arial, sans-serif" font-size="128" font-weight="700" fill="white">${initial}</text>
</svg>`;

  // Convert SVG to base64
  const base64Data = btoa(unescape(encodeURIComponent(svg)));

  return { base64Data, mimeType: 'image/svg+xml' };
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

    // --- Validate Username ---
    const usernameResult = validateUsername(data.username);
    if (!usernameResult.valid) return errorResponse(usernameResult.error);

    // --- Validate Password ---
    const passwordResult = validatePassword(data.password);
    if (!passwordResult.valid) return errorResponse(passwordResult.error);

    // --- Validate Display Name (required) ---
    const nameResult = validateField(data.memberName, 50, 'Display Name');
    if (!nameResult.valid) return errorResponse(nameResult.error);

    // --- Validate Trainer ID (optional) ---
    const trainerResult = validateTrainerId(data.trainerID);
    if (!trainerResult.valid) return errorResponse(trainerResult.error);

    // --- Validate Favorite Uma (optional) ---
    const favUmaResult = validateOptionalField(data.favoriteUma, 50, 'Favorite Umamusume');
    if (!favUmaResult.valid) return errorResponse(favUmaResult.error);

    // --- Validate Bio (optional) ---
    const bioResult = validateOptionalField(data.bio, 500, 'Bio');
    if (!bioResult.valid) return errorResponse(bioResult.error);

    // --- Check for duplicate Username ---
    const existingUsername = await db
      .prepare('SELECT id FROM members WHERE username = ?')
      .bind(usernameResult.value)
      .first();
    if (existingUsername) {
      return errorResponse('This username is already taken.');
    }

    // --- Check for duplicate Trainer ID (if provided) ---
    if (trainerResult.value) {
      const existingTrainer = await db
        .prepare('SELECT id FROM members WHERE trainer_id = ?')
        .bind(trainerResult.value)
        .first();
      if (existingTrainer) {
        return errorResponse('This Trainer ID is already registered.');
      }
    }

    // --- Validate Profile Picture (optional) ---
    let base64Data;
    let profilePictureMime;

    if (data.profilePicture && data.mimeType) {
      // User provided a profile picture
      if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
        return errorResponse('Invalid image format. Allowed: PNG, JPEG, GIF, WebP.');
      }

      // Extract base64 data (strip data URL prefix if present)
      try {
        base64Data = data.profilePicture.includes(',')
          ? data.profilePicture.split(',')[1]
          : data.profilePicture;

        // Validate that it's real base64 by decoding
        const decoded = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        if (decoded.length > MAX_IMAGE_SIZE_BYTES) {
          return errorResponse('Image file too large. Maximum size is 5MB.');
        }
        profilePictureMime = data.mimeType;
      } catch {
        return errorResponse('Invalid image data.');
      }
    } else {
      // No profile picture provided — generate a default placeholder avatar
      const placeholder = generateDefaultAvatar(sanitizeText(nameResult.value));
      base64Data = placeholder.base64Data;
      profilePictureMime = placeholder.mimeType;
    }

    // --- Hash Password ---
    const { hash, salt } = await hashPassword(data.password);

    // --- Sanitize and Save Member to D1 ---
    const sanitizedName = sanitizeText(nameResult.value);
    const sanitizedFavUma = favUmaResult.value ? sanitizeText(favUmaResult.value) : null;
    const sanitizedBio = bioResult.value ? sanitizeText(bioResult.value) : null;

    try {
      await db
        .prepare(
          `INSERT INTO members (username, password_hash, password_salt, name, trainer_id, favorite_uma, bio, profile_picture_data, profile_picture_mime, role, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'member', 'pending')`
        )
        .bind(
          usernameResult.value,
          hash,
          salt,
          sanitizedName,
          trainerResult.value,
          sanitizedFavUma,
          sanitizedBio,
          base64Data,
          profilePictureMime
        )
        .run();
    } catch (dbError) {
      console.error('D1 insert error:', dbError.message);
      return errorResponse('Failed to save registration. Please try again.');
    }

    // --- Auto-login: issue JWT ---
    // Get the newly created member's ID
    const newMember = await db
      .prepare('SELECT id FROM members WHERE username = ?')
      .bind(usernameResult.value)
      .first();

    let cookieHeader = '';
    if (newMember && env.JWT_SECRET) {
      const token = await createJWT(
        { userId: newMember.id, username: usernameResult.value, role: 'member' },
        env.JWT_SECRET
      );
      cookieHeader = sessionCookieValue(token);
    }

    const responseHeaders = {};
    if (cookieHeader) {
      responseHeaders['Set-Cookie'] = cookieHeader;
    }
    return jsonResponse(
      { result: 'success', message: 'Account created! You can now explore the site and edit your profile. To submit fan content or guides, an admin will need to approve your membership first.' },
      200,
      responseHeaders
    );

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
