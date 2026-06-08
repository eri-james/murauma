/**
 * GET /api/me — Current User Info
 * 
 * Returns the currently authenticated user's profile data.
 * Uses JWT from httpOnly cookie for authentication.
 * Returns 401 if not logged in.
 */
import {
  errorResponse,
  requireAuth,
} from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const { user, error } = await requireAuth(request, env);
    if (error) return error;

    // Fetch full member data
    const member = await db
      .prepare(
        `SELECT id, username, name, trainer_id, favorite_uma, bio, role, status, created_at
         FROM members WHERE id = ?`
      )
      .bind(user.userId)
      .first();

    if (!member) {
      return errorResponse('User not found.', 404);
    }

    return new Response(
      JSON.stringify({
        result: 'success',
        user: {
          userId: member.id,
          username: member.username,
          displayName: member.name,
          trainerId: member.trainer_id,
          favoriteUma: member.favorite_uma,
          bio: member.bio,
          role: member.role,
          status: member.status,
          avatarUrl: member.trainer_id
            ? `/api/avatar/${member.trainer_id}`
            : `/api/avatar/${member.id}`,
          joinedAt: member.created_at,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error) {
    console.error('Get current user error:', error.message);
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
