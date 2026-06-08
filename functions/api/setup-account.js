/**
 * POST /api/setup-account — Claim Legacy Account
 * 
 * Allows members who registered before the auth migration
 * (those with username=NULL) to set up their username and password.
 * They must provide their trainer_id to verify account ownership.
 * 
 * Request body (JSON):
 *   { trainerID, username, password, hCaptchaToken }
 */
import {
  errorResponse,
  jsonResponse,
  validateTrainerId,
  validateUsername,
  validatePassword,
  verifyHcaptcha,
  hashPassword,
  sanitizeText,
  checkRateLimit,
  getClientKey,
  sessionCookieValue,
  createJWT,
} from '../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    if (!env.JWT_SECRET) {
      console.error('JWT_SECRET not configured.');
      return errorResponse('Server configuration error.', 500);
    }

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

    // --- Validate Trainer ID (required for account lookup) ---
    const trainerResult = validateTrainerId(data.trainerID);
    if (!trainerResult.valid || !trainerResult.value) {
      return errorResponse('Trainer ID is required to claim your account.');
    }

    // --- Validate Username ---
    const usernameResult = validateUsername(data.username);
    if (!usernameResult.valid) return errorResponse(usernameResult.error);

    // --- Validate Password ---
    const passwordResult = validatePassword(data.password);
    if (!passwordResult.valid) return errorResponse(passwordResult.error);

    // --- Look up member by trainer_id ---
    const member = await db
      .prepare('SELECT id, username, name, trainer_id, status FROM members WHERE trainer_id = ?')
      .bind(trainerResult.value)
      .first();

    if (!member) {
      return errorResponse('No account found with this Trainer ID.');
    }

    // --- Check if already claimed ---
    if (member.username) {
      return errorResponse('This account has already been set up. Please log in with your username and password.');
    }

    // --- Check for duplicate username ---
    const existingUsername = await db
      .prepare('SELECT id FROM members WHERE username = ? AND id != ?')
      .bind(usernameResult.value, member.id)
      .first();
    if (existingUsername) {
      return errorResponse('This username is already taken.');
    }

    // --- Hash Password ---
    const { hash, salt } = await hashPassword(data.password);

    // --- Update member with username and password ---
    try {
      await db
        .prepare('UPDATE members SET username = ?, password_hash = ?, password_salt = ? WHERE id = ?')
        .bind(usernameResult.value, hash, salt, member.id)
        .run();
    } catch (dbError) {
      console.error('Account setup error:', dbError.message);
      return errorResponse('Failed to set up account. Please try again.');
    }

    // --- Issue JWT ---
    const token = await createJWT(
      { userId: member.id, username: usernameResult.value, role: 'member' },
      env.JWT_SECRET
    );

    return jsonResponse(
      {
        result: 'success',
        message: 'Account set up successfully! You are now logged in.',
        user: {
          userId: member.id,
          username: usernameResult.value,
          displayName: member.name,
        },
      },
      200,
      { 'Set-Cookie': sessionCookieValue(token) }
    );

  } catch (error) {
    console.error('Account setup error:', error.message);
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
