/**
 * Public API — Racer Leaderboard Member Detail
 *
 * GET /api/race-leaderboard/member?memberId=N — Recent race results for inline expansion
 *
 * Query parameters:
 *   ?memberId=N   — Required. Member ID to look up
 *   ?category=graded — Which division to show recent races for (default: graded)
 *   ?allTime=true  — Skip season filter
 *
 * Returns the member's recent race results (last 10) with position, points,
 * and race title. Also includes a cross-division summary.
 */
import {
  errorResponse,
  successResponse,
} from '../../_shared/utils.js';

const VALID_CATEGORIES = ['open', 'graded'];

const CURRENT_SEASON_START = '2026-06-01';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const memberId = parseInt(url.searchParams.get('memberId'), 10);
    const category = (url.searchParams.get('category') || 'graded').toLowerCase();
    const allTime = url.searchParams.get('allTime') === 'true';

    if (!memberId || isNaN(memberId)) {
      return errorResponse('Valid memberId is required.');
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return errorResponse('Category must be "open" or "graded".');
    }

    const seasonStart = allTime ? '1970-01-01' : CURRENT_SEASON_START;

    // Fetch member info
    const member = await db
      .prepare('SELECT id, name, trainer_id FROM members WHERE id = ?')
      .bind(memberId)
      .first();

    if (!member) {
      return errorResponse('Member not found.', 404);
    }

    // Recent race results in this category (last 10)
    const { results: recentRaces } = await db
      .prepare(
        `SELECT rp.race_id, rp.position, rp.category, wr.title, wr.created_at,
                CASE WHEN rp.position = 1 THEN 10
                     WHEN rp.position = 2 THEN 6
                     WHEN rp.position = 3 THEN 4
                     WHEN rp.position = 4 THEN 2
                     ELSE 1 END AS points
         FROM race_participants rp
         JOIN weekly_races wr ON wr.id = rp.race_id
         WHERE rp.member_id = ?
           AND rp.position IS NOT NULL
           AND rp.category = ?
           AND wr.created_at >= ?
         ORDER BY wr.created_at DESC
         LIMIT 10`
      )
      .bind(memberId, category, seasonStart)
      .all();

    // Stats in this category
    const stats = await db
      .prepare(
        `SELECT
          COUNT(*) AS total_races,
          SUM(CASE WHEN position = 1 THEN 10
                   WHEN position = 2 THEN 6
                   WHEN position = 3 THEN 4
                   WHEN position = 4 THEN 2
                   ELSE 1 END) AS total_points,
          SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN position <= 3 THEN 1 ELSE 0 END) AS podiums,
          ROUND(AVG(CAST(position AS REAL)), 2) AS avg_position
         FROM race_participants rp
         JOIN weekly_races wr ON wr.id = rp.race_id
         WHERE rp.member_id = ?
           AND rp.position IS NOT NULL
           AND rp.category = ?
           AND wr.created_at >= ?`
      )
      .bind(memberId, category, seasonStart)
      .first();

    // Cross-division summary
    const otherCategory = category === 'graded' ? 'open' : 'graded';
    const otherStats = await db
      .prepare(
        `SELECT
          COUNT(*) AS total_races,
          SUM(CASE WHEN position = 1 THEN 10
                   WHEN position = 2 THEN 6
                   WHEN position = 3 THEN 4
                   WHEN position = 4 THEN 2
                   ELSE 1 END) AS total_points
         FROM race_participants rp
         JOIN weekly_races wr ON wr.id = rp.race_id
         WHERE rp.member_id = ?
           AND rp.position IS NOT NULL
           AND rp.category = ?
           AND wr.created_at >= ?`
      )
      .bind(memberId, otherCategory, seasonStart)
      .first();

    return successResponse('Racer detail loaded.', {
      member: {
        id: member.id,
        name: member.name,
        trainerId: member.trainer_id,
        avatarUrl: member.trainer_id ? `/api/avatar/${member.trainer_id}` : `/api/avatar/${member.id}`,
      },
      category,
      recentRaces: recentRaces.map(r => ({
        raceId: r.race_id,
        raceTitle: r.title,
        date: r.created_at,
        category: r.category,
        position: r.position,
        points: r.points,
      })),
      stats: {
        totalPoints: stats?.total_points || 0,
        wins: stats?.wins || 0,
        podiums: stats?.podiums || 0,
        totalRaces: stats?.total_races || 0,
        avgPosition: stats?.avg_position || 0,
      },
      otherDivision: otherStats?.total_races > 0 ? {
        category: otherCategory,
        totalRaces: otherStats.total_races,
        totalPoints: otherStats.total_points,
      } : null,
    });
  } catch (error) {
    console.error('Racer member detail GET error:', error.message, error.stack);
    return errorResponse(`Failed to load racer detail: ${error.message}`, 500);
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
