/**
 * GET /api/weekly-races — List Published Active Weekly Races (Public)
 *
 * Query parameters:
 *   ?id=N  — Return a single published weekly race by ID
 *
 * Without ?id, returns all published active weekly races.
 */
import { errorResponse } from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const raceId = url.searchParams.get('id');

    // Single race lookup by ID
    if (raceId) {
      const id = parseInt(raceId, 10);
      if (isNaN(id) || id <= 0) {
        return errorResponse('Invalid race ID.', 400);
      }

      const row = await db
        .prepare(
          `SELECT id, title, track, deadline, description, image_url, is_active, created_at, updated_at
           FROM weekly_races
           WHERE id = ? AND status = 'published'`
        )
        .bind(id)
        .first();

      if (!row) {
        return errorResponse('Race not found.', 404);
      }

      const race = {
        id: row.id,
        title: row.title,
        track: row.track,
        deadline: row.deadline,
        description: row.description || '',
        imageUrl: row.image_url || '',
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return new Response(JSON.stringify({ result: 'success', race }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    // List all published active races
    const { results } = await db
      .prepare(
        `SELECT id, title, track, deadline, description, image_url, is_active, created_at, updated_at
         FROM weekly_races
         WHERE status = 'published' AND is_active = 1
         ORDER BY created_at DESC`
      )
      .all();

    const races = results.map(row => ({
      id: row.id,
      title: row.title,
      track: row.track,
      deadline: row.deadline,
      description: row.description || '',
      imageUrl: row.image_url || '',
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return new Response(JSON.stringify({ result: 'success', races }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('List weekly races error:', error.message);
    return errorResponse('Failed to load weekly races.', 500);
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
