/**
 * POST /api/race-participants/join — Self-Join a Race
 *
 * Allows an approved member with a Trainer ID to join a race themselves.
 * This adds them to the race_participants list, which automatically makes them
 * appear in the Pick'em roster for that race (graded category only).
 *
 * Guard rails:
 *   - Must be logged in (requireAuth)
 *   - Must be approved (status = 'approved')
 *   - Must have a Trainer ID in their profile
 *   - Race must exist and have no results entered yet
 *   - Must not already be in the same category for this race
 *   - Can join both 'open' and 'graded' (one entry per category)
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

    // --- Guard: Race must not have results yet (in either category) ---
    const hasResults = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND position IS NOT NULL LIMIT 1')
      .bind(data.raceId)
      .first();
    if (hasResults) {
      return errorResponse('Results have already been entered for this race. Joining is closed.');
    }

    // --- Guard: Not already in this category ---
    const existing = await db
      .prepare('SELECT id, category FROM race_participants WHERE race_id = ? AND member_id = ? AND category = ?')
      .bind(data.raceId, user.userId, category)
      .first();
    if (existing) {
      const label = category === 'open' ? 'Open Division' : 'Graded Division';
      return errorResponse(`You have already joined the ${label}.`);
    }

    // --- Add to race_participants ---
    await db
      .prepare('INSERT INTO race_participants (race_id, member_id, category) VALUES (?, ?, ?)')
      .bind(data.raceId, user.userId, category)
      .run();

    const label = category === 'open' ? 'Open Division' : 'Graded Division';
    return successResponse(`You have joined the ${label}!`, {
      memberId: user.userId,
      memberName: member.name,
      category,
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
