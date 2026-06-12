/**
 * Public API — Race Predictions (Pick'em) — Base endpoint
 *
 * GET  /api/race-predictions?raceId=N  — Get participants + prediction stats for a race
 * POST /api/race-predictions           — Submit or update a prediction (requires auth)
 */
import {
  errorResponse,
  successResponse,
  requireAuth,
  getOptionalAuth,
} from '../../_shared/utils.js';

// --- GET handler — Race participants + prediction stats ---
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const raceId = parseInt(url.searchParams.get('raceId'), 10);
    if (!raceId || isNaN(raceId)) {
      return errorResponse('Valid raceId is required.');
    }

    // Get ALL participants (for join section display)
    const { results: allParticipants } = await db
      .prepare(
        `SELECT rp.member_id, rp.category, rp.position, m.name AS member_name, m.trainer_id
         FROM race_participants rp
         JOIN members m ON m.id = rp.member_id
         WHERE rp.race_id = ?
         ORDER BY rp.added_at ASC`
      )
      .bind(raceId)
      .all();

    // Pick'em roster: graded only (predictions are for graded division)
    const roster = allParticipants
      .filter(row => row.category === 'graded')
      .map(row => ({
        memberId: row.member_id,
        memberName: row.member_name,
        trainerId: row.trainer_id,
        avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.member_id}`,
        position: row.position,
      }));

    // Open division roster (no predictions, display only)
    const openRoster = allParticipants
      .filter(row => row.category === 'open')
      .map(row => ({
        memberId: row.member_id,
        memberName: row.member_name,
        trainerId: row.trainer_id,
        avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.member_id}`,
        position: row.position,
      }));

    // Get prediction count and "popular picks" (aggregate stats)
    const predStats = await db
      .prepare(
        `SELECT COUNT(*) AS total_predictions FROM race_predictions WHERE race_id = ?`
      )
      .bind(raceId)
      .first();

    // Popular picks — count how many times each member was picked for each position
    const { results: pick1Counts } = await db
      .prepare(
        `SELECT pick_1st AS member_id, m.name, COUNT(*) AS count
         FROM race_predictions rp JOIN members m ON m.id = rp.pick_1st
         WHERE rp.race_id = ? GROUP BY pick_1st ORDER BY count DESC`
      )
      .bind(raceId)
      .all();

    const { results: pick2Counts } = await db
      .prepare(
        `SELECT pick_2nd AS member_id, m.name, COUNT(*) AS count
         FROM race_predictions rp JOIN members m ON m.id = rp.pick_2nd
         WHERE rp.race_id = ? GROUP BY pick_2nd ORDER BY count DESC`
      )
      .bind(raceId)
      .all();

    const { results: pick3Counts } = await db
      .prepare(
        `SELECT pick_3rd AS member_id, m.name, COUNT(*) AS count
         FROM race_predictions rp JOIN members m ON m.id = rp.pick_3rd
         WHERE rp.race_id = ? GROUP BY pick_3rd ORDER BY count DESC`
      )
      .bind(raceId)
      .all();

    // Check if current user has already predicted (if logged in)
    let myPrediction = null;
    const user = await getOptionalAuth(request, env);
    if (user) {
      const pred = await db
        .prepare('SELECT id, pick_1st, pick_2nd, pick_3rd, score FROM race_predictions WHERE race_id = ? AND user_id = ?')
        .bind(raceId, user.userId)
        .first();
      if (pred) {
        myPrediction = {
          id: pred.id,
          pick1st: pred.pick_1st,
          pick2nd: pred.pick_2nd,
          pick3rd: pred.pick_3rd,
          score: pred.score,
        };
      }
    }

    // Results available?
    const hasResults = roster.some(p => p.position !== null);

    // Check what categories the current user has joined
    let myCategories = [];
    if (user) {
      myCategories = allParticipants
        .filter(row => row.member_id === user.userId)
        .map(row => row.category);
    }

    return successResponse('Race prediction data loaded.', {
      roster,
      openRoster,
      totalPredictions: predStats?.total_predictions || 0,
      popularPicks: {
        first: pick1Counts.map(r => ({ memberId: r.member_id, name: r.name, count: r.count })),
        second: pick2Counts.map(r => ({ memberId: r.member_id, name: r.name, count: r.count })),
        third: pick3Counts.map(r => ({ memberId: r.member_id, name: r.name, count: r.count })),
      },
      myPrediction,
      myCategories,
      hasResults,
    });
  } catch (error) {
    console.error('Race predictions GET error:', error.message, error.stack);
    return errorResponse(`Failed to load prediction data: ${error.message}`, 500);
  }
}

// --- POST handler — Submit or update prediction ---
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAuth(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.raceId || !Number.isInteger(data.raceId)) {
      return errorResponse('Valid raceId is required.');
    }
    if (!data.pick1st || !Number.isInteger(data.pick1st)) {
      return errorResponse('pick1st (member ID) is required.');
    }
    if (!data.pick2nd || !Number.isInteger(data.pick2nd)) {
      return errorResponse('pick2nd (member ID) is required.');
    }
    if (!data.pick3rd || !Number.isInteger(data.pick3rd)) {
      return errorResponse('pick3rd (member ID) is required.');
    }

    // All 3 picks must be different
    if (data.pick1st === data.pick2nd || data.pick1st === data.pick3rd || data.pick2nd === data.pick3rd) {
      return errorResponse('You must pick 3 different racers for 1st, 2nd, and 3rd.');
    }

    // Verify race exists
    const race = await db.prepare('SELECT id FROM weekly_races WHERE id = ?').bind(data.raceId).first();
    if (!race) return errorResponse('Race not found.');

    // Verify all picked members are graded participants (Pick'em is graded-only)
    for (const pickId of [data.pick1st, data.pick2nd, data.pick3rd]) {
      const participant = await db
        .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ? AND category = ?')
        .bind(data.raceId, pickId, 'graded')
        .first();
      if (!participant) {
        return errorResponse(`Member #${pickId} is not a graded division participant in this race.`);
      }
    }

    // Check if results are already in — can't predict after results
    const hasResults = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND position IS NOT NULL LIMIT 1')
      .bind(data.raceId)
      .first();
    if (hasResults) {
      return errorResponse('Results have already been entered for this race. Predictions are closed.');
    }

    // Upsert prediction (one per user per race)
    const existing = await db
      .prepare('SELECT id FROM race_predictions WHERE race_id = ? AND user_id = ?')
      .bind(data.raceId, user.userId)
      .first();

    if (existing) {
      // Update existing prediction
      await db
        .prepare(
          `UPDATE race_predictions SET pick_1st = ?, pick_2nd = ?, pick_3rd = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(data.pick1st, data.pick2nd, data.pick3rd, existing.id)
        .run();
      return successResponse('Prediction updated!', { updated: true });
    } else {
      // Create new prediction
      await db
        .prepare(
          `INSERT INTO race_predictions (race_id, user_id, pick_1st, pick_2nd, pick_3rd)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(data.raceId, user.userId, data.pick1st, data.pick2nd, data.pick3rd)
        .run();
      return successResponse('Prediction submitted!', { updated: false });
    }
  } catch (error) {
    console.error('Race predictions POST error:', error.message);
    return errorResponse('Failed to submit prediction.', 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
