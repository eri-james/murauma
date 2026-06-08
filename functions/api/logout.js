/**
 * POST /api/logout — Member Logout
 * 
 * Clears the session cookie to log the user out.
 */
import {
  jsonResponse,
  clearSessionCookieValue,
} from '../_shared/utils.js';

export async function onRequestPost(context) {
  return jsonResponse(
    { result: 'success', message: 'Logged out successfully.' },
    200,
    { 'Set-Cookie': clearSessionCookieValue() }
  );
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
