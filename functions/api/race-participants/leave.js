/**
 * POST /api/race-participants/leave — Leave a Race (Self-Unjoin)
 *
 * Allows a member to remove themselves from a race (specific category) before
 * results are entered. Once results are in, leaving is disabled.
 *
 * Guard rails:
 *   - Must be logged in (requireAuth)
 *   - Must be a participant in the specified category
 *   - Race must not have results entered yet
 */
import {
  errorResponse,
  successResponse,
  requireAuth,
} from '../../_shared/utils.js';

const VALID_CATEGORIES = ['open', 'graded'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAuth(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    // --- Validate raceId ---
    if (!data.raceId || !Number.isInteger(data.raceId)) {
      return errorResponse('Valid raceId is required.');
    }

    // --- Validate category ---
    const category = (data.category || 'graded').toLowerCase();
    if (!VALID_CATEGORIES.includes(category)) {
      return errorResponse('Category must be "open" or "graded".');
    }

    // --- Guard: Must be a participant in this category ---
    const existing = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ? AND category = ?')
      .bind(data.raceId, user.userId, category)
      .first();
    if (!existing) {
      const label = category === 'open' ? 'Open Division' : 'Graded Division';
      return errorResponse(`You are not a participant in the ${label}.`);
    }

    // --- Guard: Race must not have results yet ---
    const hasResults = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND position IS NOT NULL LIMIT 1')
      .bind(data.raceId)
      .first();
    if (hasResults) {
      return errorResponse('Results have already been entered. You cannot leave this race.');
    }

    // --- Remove from race_participants (specific category) ---
    await db
      .prepare('DELETE FROM race_participants WHERE race_id = ? AND member_id = ? AND category = ?')
      .bind(data.raceId, user.userId, category)
      .run();

    const label = category === 'open' ? 'Open Division' : 'Graded Division';
    return successResponse(`You have left the ${label}.`);

  } catch (error) {
    console.error('Self-leave race error:', error.message);
    return errorResponse('Failed to leave race.', 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
