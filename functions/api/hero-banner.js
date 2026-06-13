/**
 * GET /api/hero-banner — Get the active hero banner (Public)
 *
 * Returns the single banner where is_active = 1.
 * If no active banner exists, returns an empty result.
 */
import { errorResponse } from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    const banner = await db
      .prepare(
        `SELECT id, title, description, link_url, media_type, media_url, poster_url, is_active, created_at, updated_at
         FROM hero_banner
         WHERE is_active = 1
         LIMIT 1`
      )
      .first();

    if (!banner) {
      return new Response(JSON.stringify({ result: 'success', banner: null }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(JSON.stringify({
      result: 'success',
      banner: {
        id: banner.id,
        title: banner.title,
        description: banner.description || '',
        linkUrl: banner.link_url || '',
        mediaType: banner.media_type,
        mediaUrl: banner.media_url || '',
        posterUrl: banner.poster_url || '',
        isActive: banner.is_active,
        createdAt: banner.created_at,
        updatedAt: banner.updated_at,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('Get hero banner error:', error.message);
    return errorResponse('Failed to load hero banner.', 500);
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
