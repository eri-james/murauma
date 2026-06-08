/**
 * GET /api/news — List Published News / Get Single News (Public)
 *
 * Query parameters:
 *   slug — Get a single news post by slug (returns full content)
 *   (no params) — List all published news (summary only)
 *   category — Filter by category (event, community, update)
 */
import { errorResponse, getOptionalAuth } from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    const category = url.searchParams.get('category');

    // --- Single news lookup ---
    if (slug) {
      const newsItem = await db
        .prepare(
          `SELECT id, title, slug, category, description, content, image_url, status, created_at, updated_at
           FROM news WHERE slug = ?`
        )
        .bind(slug)
        .first();

      if (!newsItem) {
        return errorResponse('News post not found.', 404);
      }

      // Only show published news to non-admins
      if (newsItem.status !== 'published') {
        const user = await getOptionalAuth(request, env);
        if (!user || user.role !== 'admin') {
          return errorResponse('News post not found.', 404);
        }
      }

      return new Response(JSON.stringify({
        result: 'success',
        news: {
          id: newsItem.id,
          title: newsItem.title,
          slug: newsItem.slug,
          category: newsItem.category,
          description: newsItem.description || '',
          content: newsItem.content || '',
          imageUrl: newsItem.image_url || '',
          status: newsItem.status,
          createdAt: newsItem.created_at,
          updatedAt: newsItem.updated_at,
        },
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // --- List all published news ---
    let query, params;
    if (category && ['event', 'community', 'update'].includes(category)) {
      query = `
        SELECT id, title, slug, category, description, image_url, created_at
        FROM news
        WHERE status = 'published' AND category = ?
        ORDER BY created_at DESC
      `;
      params = [category];
    } else {
      query = `
        SELECT id, title, slug, category, description, image_url, created_at
        FROM news
        WHERE status = 'published'
        ORDER BY created_at DESC
      `;
      params = [];
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const news = results.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      category: row.category,
      description: row.description || '',
      imageUrl: row.image_url || '',
      createdAt: row.created_at,
    }));

    return new Response(JSON.stringify({ result: 'success', news }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('List news error:', error.message);
    return errorResponse('Failed to load news.', 500);
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
