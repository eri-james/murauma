/**
 * POST /api/login — Member Login
 * 
 * Authenticates a member by username + password.
 * On success, issues a JWT in an httpOnly cookie.
 * 
 * Request body (JSON):
 *   { username, password }
 */
import {
  errorResponse,
  jsonResponse,
  validateUsername,
  validatePassword,
  verifyPassword,
  createJWT,
  sessionCookieValue,
  checkRateLimit,
  getClientKey,
} from '../_shared/utils.js';

// Login has a more generous rate limit than submissions: 10 attempts per 10 min
const LOGIN_RATE_LIMIT_MAX = 10;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    if (!env.JWT_SECRET) {
      console.error('JWT_SECRET not configured.');
      return errorResponse('Server configuration error.', 500);
    }

    // --- Rate Limiting ---
    const clientKey = 'login:' + getClientKey(request);
    const allowed = await checkRateLimit(db, clientKey, LOGIN_RATE_LIMIT_MAX);
    if (!allowed) {
      return errorResponse('Too many login attempts. Please try again later.', 429);
    }

    const data = await request.json();

    // --- Validate Input ---
    const usernameResult = validateUsername(data.username);
    if (!usernameResult.valid) return errorResponse(usernameResult.error);

    const passwordResult = validatePassword(data.password);
    if (!passwordResult.valid) return errorResponse(passwordResult.error);

    // --- Look up member ---
    const member = await db
      .prepare('SELECT id, username, password_hash, password_salt, name, role, status FROM members WHERE username = ?')
      .bind(usernameResult.value)
      .first();

    if (!member) {
      return errorResponse('Invalid username or password.', 401);
    }

    // --- Check if account has been set up (legacy migration) ---
    if (!member.password_hash || !member.password_salt) {
      return errorResponse('Your account needs to be set up. Please use the Account Setup page to create a username and password.', 403);
    }

    // --- Check if account is approved ---
    if (member.status === 'pending') {
      return errorResponse('Your registration is still pending admin approval.', 403);
    }

    if (member.status === 'rejected') {
      return errorResponse('Your registration has been rejected.', 403);
    }

    // --- Verify Password ---
    const isValid = await verifyPassword(data.password, member.password_hash, member.password_salt);
    if (!isValid) {
      return errorResponse('Invalid username or password.', 401);
    }

    // --- Create JWT ---
    const token = await createJWT(
      { userId: member.id, username: member.username, role: member.role },
      env.JWT_SECRET
    );

    // --- Return success with session cookie ---
    return jsonResponse(
      {
        result: 'success',
        message: 'Logged in successfully.',
        user: {
          userId: member.id,
          username: member.username,
          displayName: member.name,
          role: member.role,
        },
      },
      200,
      { 'Set-Cookie': sessionCookieValue(token) }
    );

  } catch (error) {
    console.error('Login error:', error.message);
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
