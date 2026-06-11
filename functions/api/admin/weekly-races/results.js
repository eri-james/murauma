/**
 * Admin API — Race Results & Scoring
 *
 * POST /api/admin/weekly-races/results — Enter race results (positions) and auto-score predictions
 *
 * Request body: { raceId, results: [{ memberId, position }] }
 * Positions should be 1, 2, 3... for top finishers.
 * After saving positions, all predictions for this race are auto-scored.
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.raceId || !Number.isInteger(data.raceId)) {
      return errorResponse('Valid raceId is required.');
    }

    if (!Array.isArray(data.results) || data.results.length === 0) {
      return errorResponse('Results array is required with at least one entry.');
    }

    // Validate each result entry
    for (const r of data.results) {
      if (!Number.isInteger(r.memberId) || !Number.isInteger(r.position) || r.position < 1) {
        return errorResponse('Each result must have a valid memberId and position (positive integer).');
      }
    }

    // Verify race exists
    const race = await db.prepare('SELECT id FROM weekly_races WHERE id = ?').bind(data.raceId).first();
    if (!race) return errorResponse('Race not found.');

    // Verify all members are participants in this race
    for (const r of data.results) {
      const participant = await db
        .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ?')
        .bind(data.raceId, r.memberId)
        .first();
      if (!participant) {
        return errorResponse(`Member #${r.memberId} is not a participant in this race.`);
      }
    }

    // Clear existing positions for this race first
    await db
      .prepare('UPDATE race_participants SET position = NULL WHERE race_id = ?')
      .bind(data.raceId)
      .run();

    // Set new positions
    for (const r of data.results) {
      await db
        .prepare('UPDATE race_participants SET position = ? WHERE race_id = ? AND member_id = ?')
        .bind(r.position, data.raceId, r.memberId)
        .run();
    }

    // --- Auto-score predictions ---
    // Get the top 3 finishers
    const topFinishers = await db
      .prepare(
        `SELECT member_id, position FROM race_participants
         WHERE race_id = ? AND position IS NOT NULL AND position <= 3
         ORDER BY position ASC`
      )
      .bind(data.raceId)
      .all();

    const firstPlace = topFinishers.results.find(r => r.position === 1)?.member_id || null;
    const secondPlace = topFinishers.results.find(r => r.position === 2)?.member_id || null;
    const thirdPlace = topFinishers.results.find(r => r.position === 3)?.member_id || null;

    // Score all predictions
    const predictions = await db
      .prepare('SELECT id, pick_1st, pick_2nd, pick_3rd FROM race_predictions WHERE race_id = ?')
      .bind(data.raceId)
      .all();

    let scoredCount = 0;
    for (const pred of predictions.results) {
      let score = 0;
      if (firstPlace !== null && pred.pick_1st === firstPlace) score += 3;
      if (secondPlace !== null && pred.pick_2nd === secondPlace) score += 2;
      if (thirdPlace !== null && pred.pick_3rd === thirdPlace) score += 1;

      await db
        .prepare('UPDATE race_predictions SET score = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(score, pred.id)
        .run();
      scoredCount++;
    }

    return successResponse(`Results saved. ${scoredCount} prediction(s) scored.`, {
      topFinishers: { 1: firstPlace, 2: secondPlace, 3: thirdPlace },
      predictionsScored: scoredCount,
    });
  } catch (error) {
    console.error('Admin save results error:', error.message);
    return errorResponse('Failed to save results.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}
