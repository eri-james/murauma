/**
 * POST /api/race-participants/join — Self-Join a Race
 *
 * Allows an approved member with a Trainer ID to join a race themselves.
 * This adds them to the race_participants list, which automatically makes them
 * appear in the Pick'em roster for that race.
 *
 * Guard rails:
 *   - Must be logged in (requireAuth)
 *   - Must be approved (status = 'approved')
 *   - Must have a Trainer ID in their profile
 *   - Race must exist and have no results entered yet
 *   - Must not already be a participant
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

    // --- Fetch member data (need status + trainer_id) ---
    const member = await db
      .prepare('SELECT id, name, trainer_id, status FROM members WHERE id = ?')
      .bind(user.userId)
      .first();

    if (!member) {
      return errorResponse('Member not found.', 404);
    }

    // --- Guard: Must be approved ---
    if (member.status !== 'approved') {
      return errorResponse('Your account must be approved before joining races.');
    }

    // --- Guard: Must have Trainer ID ---
    if (!member.trainer_id) {
      return errorResponse('Add your Trainer ID to your profile to join races.');
    }

    // --- Guard: Race must exist ---
    const race = await db
      .prepare('SELECT id, title FROM weekly_races WHERE id = ?')
      .bind(data.raceId)
      .first();
    if (!race) {
      return errorResponse('Race not found.');
    }

    // --- Guard: Race must not have results yet ---
    const hasResults = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND position IS NOT NULL LIMIT 1')
      .bind(data.raceId)
      .first();
    if (hasResults) {
      return errorResponse('Results have already been entered for this race. Joining is closed.');
    }

    // --- Guard: Not already a participant ---
    const existing = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ?')
      .bind(data.raceId, user.userId)
      .first();
    if (existing) {
      return errorResponse('You have already joined this race.');
    }

    // --- Add to race_participants ---
    await db
      .prepare('INSERT INTO race_participants (race_id, member_id) VALUES (?, ?)')
      .bind(data.raceId, user.userId)
      .run();

    return successResponse('You have joined the race!', {
      memberId: user.userId,
      memberName: member.name,
    });

  } catch (error) {
    console.error('Self-join race error:', error.message);
    return errorResponse('Failed to join race.', 500);
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
