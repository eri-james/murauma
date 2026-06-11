/**
 * Public API — Race Predictions Leaderboard
 *
 * GET /api/race-predictions/leaderboard — Get overall prediction leaderboard
 */
import {
  errorResponse,
  successResponse,
} from '../../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    const { results } = await db
      .prepare(
        `SELECT rp.user_id, m.name AS member_name, m.trainer_id,
                COUNT(rp.id) AS races_predicted,
                SUM(COALESCE(rp.score, 0)) AS total_score
         FROM race_predictions rp
         JOIN members m ON m.id = rp.user_id
         WHERE rp.score IS NOT NULL
         GROUP BY rp.user_id
         ORDER BY total_score DESC, races_predicted ASC
         LIMIT 50`
      )
      .all();

    const leaderboard = results.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      memberName: row.member_name,
      trainerId: row.trainer_id,
      avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.user_id}`,
      racesPredicted: row.races_predicted,
      totalScore: row.total_score,
    }));

    return successResponse('Leaderboard loaded.', { leaderboard });
  } catch (error) {
    console.error('Leaderboard GET error:', error.message, error.stack);
    return errorResponse(`Failed to load leaderboard: ${error.message}`, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
