/**
 * Public API — Racer Leaderboard
 *
 * GET /api/race-leaderboard — Aggregated racer rankings by performance
 *
 * Query parameters:
 *   ?category=graded   — Division filter (default: 'graded')
 *   ?allTime=true       — Skip season date filter
 *   ?season=2026s1      — Season identifier (optional)
 *
 * Scoring: 1st=10, 2nd=6, 3rd=4, 4th=2, 5th+=1
 * Tiebreaker: most 1sts → most 2nds → most 3rds → fewest races
 *
 * No new tables — pure aggregation over race_participants + weekly_races.
 */
import {
  errorResponse,
  successResponse,
} from '../../_shared/utils.js';

const VALID_CATEGORIES = ['open', 'graded'];

// Season configuration (v1: hardcoded, promote to D1 table when needed)
const SEASONS = {
  '2026s1': {
    id: '2026s1',
    label: 'Season 1 2026',
    startDate: '2026-06-01',
    endDate: null, // null = ongoing
  },
};

const CURRENT_SEASON = '2026s1';

// Scoring map
function positionPoints(pos) {
  if (pos === 1) return 10;
  if (pos === 2) return 6;
  if (pos === 3) return 4;
  if (pos === 4) return 2;
  return 1; // 5th and below
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const category = (url.searchParams.get('category') || 'graded').toLowerCase();
    const allTime = url.searchParams.get('allTime') === 'true';
    const seasonId = url.searchParams.get('season') || CURRENT_SEASON;

    if (!VALID_CATEGORIES.includes(category)) {
      return errorResponse('Category must be "open" or "graded".');
    }

    // Determine season date range
    const season = SEASONS[seasonId] || SEASONS[CURRENT_SEASON];
    const seasonStart = allTime ? '1970-01-01' : (season?.startDate || '1970-01-01');

    // Count races with results in this category for the season
    const raceCountResult = await db
      .prepare(
        `SELECT COUNT(DISTINCT rp.race_id) AS race_count
         FROM race_participants rp
         JOIN weekly_races wr ON wr.id = rp.race_id
         WHERE rp.position IS NOT NULL
           AND rp.category = ?
           AND wr.created_at >= ?`
      )
      .bind(category, seasonStart)
      .first();

    const raceCount = raceCountResult?.race_count || 0;

    if (raceCount === 0) {
      return successResponse('No race results yet for this division.', {
        season: {
          id: season.id,
          label: season.label,
          startDate: season.startDate,
          raceCount: 0,
        },
        category,
        leaderboard: [],
      });
    }

    // Main leaderboard query — aggregate per member within the category
    const { results } = await db
      .prepare(
        `SELECT
          rp.member_id,
          m.name AS member_name,
          m.trainer_id,
          COUNT(*) AS total_races,
          SUM(CASE WHEN rp.position = 1 THEN 10
                   WHEN rp.position = 2 THEN 6
                   WHEN rp.position = 3 THEN 4
                   WHEN rp.position = 4 THEN 2
                   ELSE 1 END) AS total_points,
          SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN rp.position = 2 THEN 1 ELSE 0 END) AS seconds,
          SUM(CASE WHEN rp.position = 3 THEN 1 ELSE 0 END) AS thirds,
          SUM(CASE WHEN rp.position <= 3 THEN 1 ELSE 0 END) AS podiums,
          ROUND(AVG(CAST(rp.position AS REAL)), 2) AS avg_position
         FROM race_participants rp
         JOIN members m ON m.id = rp.member_id
         JOIN weekly_races wr ON wr.id = rp.race_id
         WHERE rp.position IS NOT NULL
           AND rp.category = ?
           AND wr.created_at >= ?
         GROUP BY rp.member_id
         ORDER BY total_points DESC, wins DESC, seconds DESC, thirds DESC, total_races ASC`
      )
      .bind(category, seasonStart)
      .all();

    const leaderboard = results.map((row, index) => ({
      rank: index + 1,
      memberId: row.member_id,
      memberName: row.member_name,
      trainerId: row.trainer_id,
      avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.member_id}`,
      totalPoints: row.total_points,
      wins: row.wins,
      seconds: row.seconds,
      thirds: row.thirds,
      podiums: row.podiums,
      totalRaces: row.total_races,
      avgPosition: row.avg_position,
    }));

    // For each ranked member, also grab their presence in the OTHER division
    // (shown in inline detail as "also has X entries in [other]")
    const otherCategory = category === 'graded' ? 'open' : 'graded';
    if (leaderboard.length > 0) {
      const memberIds = leaderboard.map(l => l.memberId);

      // Batch query: count other-division entries for all leaderboard members
      const placeholders = memberIds.map(() => '?').join(',');
      const otherResults = await db
        .prepare(
          `SELECT rp.member_id, COUNT(*) AS other_races,
                  SUM(CASE WHEN rp.position = 1 THEN 10
                           WHEN rp.position = 2 THEN 6
                           WHEN rp.position = 3 THEN 4
                           WHEN rp.position = 4 THEN 2
                           ELSE 1 END) AS other_points
           FROM race_participants rp
           JOIN weekly_races wr ON wr.id = rp.race_id
           WHERE rp.position IS NOT NULL
             AND rp.category = ?
             AND wr.created_at >= ?
             AND rp.member_id IN (${placeholders})
           GROUP BY rp.member_id`
        )
        .bind(otherCategory, seasonStart, ...memberIds)
        .all();

      const otherMap = {};
      for (const row of otherResults.results) {
        otherMap[row.member_id] = {
          category: otherCategory,
          totalRaces: row.other_races,
          totalPoints: row.other_points,
        };
      }

      for (const entry of leaderboard) {
        entry.otherDivision = otherMap[entry.memberId] || null;
      }
    }

    return successResponse('Leaderboard loaded.', {
      season: {
        id: season.id,
        label: season.label,
        startDate: season.startDate,
        raceCount,
      },
      category,
      leaderboard,
    });
  } catch (error) {
    console.error('Racer leaderboard GET error:', error.message, error.stack);
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
