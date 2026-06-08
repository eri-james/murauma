/**
 * GET /api/guides — List Approved Guides / Get Single Guide (Public)
 *
 * Query parameters:
 *   slug — Get a single guide by slug (returns full content)
 *   id   — Get a single guide by ID (returns full content)
 *   (no params) — List all approved guides (summary only, with vote counts)
 */
import {
  errorResponse,
  getOptionalAuth,
} from '../../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    const id = url.searchParams.get('id');

    // --- Single guide lookup ---
    if (slug || id) {
      let query;
      let params;

      if (slug) {
        query = `
          SELECT g.id, g.user_id, g.title, g.slug, g.content, g.author_name, g.status, g.created_at, g.updated_at,
            COALESCE(v.total_votes, 0) AS vote_score
          FROM guides g
          LEFT JOIN (SELECT guide_id, SUM(vote) AS total_votes FROM guide_votes GROUP BY guide_id) v ON g.id = v.guide_id
          WHERE g.slug = ?
        `;
        params = [slug];
      } else {
        query = `
          SELECT g.id, g.user_id, g.title, g.slug, g.content, g.author_name, g.status, g.created_at, g.updated_at,
            COALESCE(v.total_votes, 0) AS vote_score
          FROM guides g
          LEFT JOIN (SELECT guide_id, SUM(vote) AS total_votes FROM guide_votes GROUP BY guide_id) v ON g.id = v.guide_id
          WHERE g.id = ?
        `;
        params = [parseInt(id, 10)];
      }

      const guide = await db.prepare(query).bind(...params).first();

      if (!guide) {
        return errorResponse('Guide not found.', 404);
      }

      // Only show approved guides to non-admins
      if (guide.status !== 'approved') {
        // Allow author or admin to see their own draft
        const user = await getOptionalAuth(request, env);
        if (!user || (user.userId !== guide.user_id && user.role !== 'admin')) {
          return errorResponse('Guide not found.', 404);
        }
      }

      // Check user's vote on this guide
      let userVote = 0;
      if (slug || id) {
        const user = await getOptionalAuth(request, env);
        if (user && user.userId > 0) {
          const voteRow = await db
            .prepare('SELECT vote FROM guide_votes WHERE user_id = ? AND guide_id = ?')
            .bind(user.userId, guide.id)
            .first();
          if (voteRow) userVote = voteRow.vote;
        }
      }

      return new Response(JSON.stringify({
        result: 'success',
        guide: {
          id: guide.id,
          userId: guide.user_id,
          title: guide.title,
          slug: guide.slug,
          content: guide.content,
          author: guide.author_name || 'Unknown',
          status: guide.status,
          voteScore: guide.vote_score || 0,
          userVote,
          createdAt: guide.created_at,
          updatedAt: guide.updated_at,
        },
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // --- List all approved guides (summary) ---
    const { results } = await db
      .prepare(
        `SELECT g.id, g.title, g.slug, g.author_name, g.created_at, g.updated_at,
          COALESCE(v.total_votes, 0) AS vote_score,
          LENGTH(g.content) AS content_length
         FROM guides g
         LEFT JOIN (SELECT guide_id, SUM(vote) AS total_votes FROM guide_votes GROUP BY guide_id) v ON g.id = v.guide_id
         WHERE g.status = 'approved'
         ORDER BY g.created_at DESC`
      )
      .all();

    const guides = results.map(row => ({
      id: row.id,
      title: row.title || '',
      slug: row.slug,
      author: row.author_name || 'Unknown',
      voteScore: row.vote_score || 0,
      preview: '', // No content preview for performance
      contentLength: row.content_length || 0,
      timestamp: row.created_at,
      updatedAt: row.updated_at,
    }));

    return new Response(JSON.stringify({ result: 'success', guides }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30',
      },
    });

  } catch (error) {
    console.error('List guides error:', error.message);
    return errorResponse('Failed to load guides.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
