/**
 * GET /api/events — List Published Events / Get Single Event (Public)
 *
 * Query parameters:
 *   slug — Get a single event by slug (returns full content)
 *   (no params) — List all published events (summary only)
 */
import { errorResponse, getOptionalAuth } from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');

    // --- Single event lookup ---
    if (slug) {
      const event = await db
        .prepare(
          `SELECT id, title, slug, description, content, image_url, start_date, end_date, status, created_at, updated_at
           FROM events WHERE slug = ?`
        )
        .bind(slug)
        .first();

      if (!event) {
        return errorResponse('Event not found.', 404);
      }

      // Only show published events to non-admins
      if (event.status !== 'published') {
        const user = await getOptionalAuth(request, env);
        if (!user || user.role !== 'admin') {
          return errorResponse('Event not found.', 404);
        }
      }

      return new Response(JSON.stringify({
        result: 'success',
        event: {
          id: event.id,
          title: event.title,
          slug: event.slug,
          description: event.description || '',
          content: event.content || '',
          imageUrl: event.image_url || '',
          startDate: event.start_date,
          endDate: event.end_date || '',
          status: event.status,
          createdAt: event.created_at,
          updatedAt: event.updated_at,
        },
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // --- List all published events ---
    const { results } = await db
      .prepare(
        `SELECT id, title, slug, description, image_url, start_date, end_date, created_at
         FROM events
         WHERE status = 'published'
         ORDER BY start_date DESC`
      )
      .all();

    const events = results.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description || '',
      imageUrl: row.image_url || '',
      startDate: row.start_date,
      endDate: row.end_date || '',
      createdAt: row.created_at,
    }));

    return new Response(JSON.stringify({ result: 'success', events }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('List events error:', error.message);
    return errorResponse('Failed to load events.', 500);
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
