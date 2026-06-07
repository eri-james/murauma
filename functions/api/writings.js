/**
 * GET /api/writings — List Writings
 * 
 * Returns all approved writings sorted by most recent first.
 * Data is sanitized before sending as defense-in-depth,
 * complementing client-side DOMPurify.
 */
import {
  errorResponse,
  sanitizeHtml,
  sanitizeText,
} from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  try {
    const { results } = await db
      .prepare(
        `SELECT id, title, author_name, content, created_at
         FROM writings
         ORDER BY created_at DESC`
      )
      .all();

    // Sanitize data before sending to client (defense in depth)
    // Title is plain text — escape entities; Content may have HTML from Markdown
    const writings = results.map(row => ({
      id: row.id,
      title: sanitizeText(row.title || ''),
      author: sanitizeText(row.author_name || 'Unknown'),
      content: sanitizeHtml(row.content || ''),
      timestamp: row.created_at,
    }));

    return new Response(JSON.stringify({ result: 'success', writings }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Cache for 60 seconds at the edge to reduce D1 reads
        'Cache-Control': 'public, max-age=60',
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
