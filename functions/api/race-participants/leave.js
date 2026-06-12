/**
 * POST /api/race-participants/leave — Leave a Race (Self-Unjoin)
 *
 * Allows a member to remove themselves from a race before results are entered.
 * Once results are in, leaving is disabled.
 *
 * Guard rails:
 *   - Must be logged in (requireAuth)
 *   - Must be a participant in the race
 *   - Race must not have results entered yet
 */
import {
  errorResponse,
  successResponse,
  requireAuth,
} from '../../_shared/utils.js';

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

    // --- Guard: Must be a participant ---
    const existing = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ?')
      .bind(data.raceId, user.userId)
      .first();
    if (!existing) {
      return errorResponse('You are not a participant in this race.');
    }

    // --- Guard: Race must not have results yet ---
    const hasResults = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND position IS NOT NULL LIMIT 1')
      .bind(data.raceId)
      .first();
    if (hasResults) {
      return errorResponse('Results have already been entered. You cannot leave this race.');
    }

    // --- Also remove any prediction the user made for this race ---
    // (If they leave the race, their pick'em prediction referencing them as a participant is invalid)
    // Actually — their prediction picks OTHER participants, not themselves. So we keep predictions.
    // But we should remove them from the roster so others can't pick them anymore.

    // --- Remove from race_participants ---
    await db
      .prepare('DELETE FROM race_participants WHERE race_id = ? AND member_id = ?')
      .bind(data.raceId, user.userId)
      .run();

    // --- Remove any pick'em predictions that picked this member ---
    // If other users picked this member as 1st/2nd/3rd, those picks now reference
    // a non-participant. We should clear those specific picks to maintain data integrity.
    // However, this would be complex and potentially confusing. Instead, the scoring
    // system naturally handles it — a pick for a non-participant simply won't match
    // any result position. We'll leave predictions as-is for simplicity.

    return successResponse('You have left the race.');

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
