/**
 * Public API — My Race Prediction
 *
 * GET /api/race-predictions/mine?raceId=N — Get current user's prediction for a race
 */
import {
  errorResponse,
  successResponse,
  requireAuth,
} from '../../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAuth(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const raceId = parseInt(url.searchParams.get('raceId'), 10);
    if (!raceId || isNaN(raceId)) {
      return errorResponse('Valid raceId is required.');
    }

    const pred = await db
      .prepare('SELECT id, pick_1st, pick_2nd, pick_3rd, score, created_at, updated_at FROM race_predictions WHERE race_id = ? AND user_id = ?')
      .bind(raceId, user.userId)
      .first();

    if (!pred) {
      return successResponse('No prediction found.', { prediction: null });
    }

    return successResponse('Prediction loaded.', {
      prediction: {
        id: pred.id,
        pick1st: pred.pick_1st,
        pick2nd: pred.pick_2nd,
        pick3rd: pred.pick_3rd,
        score: pred.score,
        createdAt: pred.created_at,
        updatedAt: pred.updated_at,
      },
    });
  } catch (error) {
    console.error('My prediction GET error:', error.message, error.stack);
    return errorResponse(`Failed to load prediction: ${error.message}`, 500);
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
