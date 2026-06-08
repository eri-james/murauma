/**
 * POST /api/guides/vote — Upvote or Downvote a Guide (Auth required)
 *
 * Reddit-style voting: +1 (upvote) or -1 (downvote).
 * Uses upsert: if user already voted, their vote is updated.
 * Sending vote=0 removes the vote.
 *
 * Request body (JSON):
 *   { guideId, vote (1 or -1 or 0) }
 */
import {
  errorResponse,
  successResponse,
  requireAuth,
} from '../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const { user, error: authError } = await requireAuth(request, env);
    if (authError) return authError;

    const data = await request.json();

    if (!data.guideId || !Number.isInteger(data.guideId)) {
      return errorResponse('Valid guide ID (integer) is required.');
    }

    if (data.vote !== 1 && data.vote !== -1 && data.vote !== 0) {
      return errorResponse('Vote must be 1 (upvote), -1 (downvote), or 0 (remove).');
    }

    // Verify guide exists and is approved
    const guide = await db
      .prepare('SELECT id, status FROM guides WHERE id = ?')
      .bind(data.guideId)
      .first();

    if (!guide) {
      return errorResponse('Guide not found.');
    }

    if (guide.status !== 'approved') {
      return errorResponse('You can only vote on approved guides.');
    }

    if (data.vote === 0) {
      // Remove vote
      await db
        .prepare('DELETE FROM guide_votes WHERE user_id = ? AND guide_id = ?')
        .bind(user.userId, data.guideId)
        .run();
    } else {
      // Upsert vote
      await db
        .prepare(
          `INSERT INTO guide_votes (user_id, guide_id, vote) VALUES (?, ?, ?)
           ON CONFLICT(user_id, guide_id) DO UPDATE SET vote = excluded.vote`
        )
        .bind(user.userId, data.guideId, data.vote)
        .run();
    }

    // Return updated vote score
    const scoreRow = await db
      .prepare('SELECT COALESCE(SUM(vote), 0) AS score FROM guide_votes WHERE guide_id = ?')
      .bind(data.guideId)
      .first();

    return successResponse('Vote recorded.', { score: scoreRow.score || 0, userVote: data.vote });

  } catch (error) {
    console.error('Guide vote error:', error.message);
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
