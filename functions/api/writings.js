/**
 * GET /api/writings — List Writings
 * 
 * Returns all approved writings sorted by most recent first.
 * Data was sanitized on insert — serve as-is from the database.
 * Client-side DOMPurify provides runtime XSS defense.
 */
import {
  errorResponse,
} from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    const { results } = await db
      .prepare(
        `SELECT id, title, author_name, content, created_at
         FROM writings
         WHERE status = 'approved'
         ORDER BY created_at DESC`
      )
      .all();

    // Data was sanitized on insert — serve as-is (no double-sanitization)
    const writings = results.map(row => ({
      id: row.id,
      title: row.title || '',
      author: row.author_name || 'Unknown',
      content: row.content || '',
      timestamp: row.created_at,
    }));

    return new Response(JSON.stringify({ result: 'success', writings }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Cache for 30 seconds at the edge to reduce D1 reads
        'Cache-Control': 'public, max-age=30',
      },
    });

  } catch (error) {
    console.error('List writings error:', error.message);
    return errorResponse('Failed to list writings.', 500);
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
