/**
 * GET /api/writings — List Writings
 * 
 * Returns approved writings sorted by most recent first.
 * Supports pagination via ?page=N&limit=N (default: page=1, limit=20).
 * Data was sanitized on insert — serve as-is from the database.
 * Client-side DOMPurify provides runtime XSS defense.
 */
import {
  errorResponse,
} from '../_shared/utils.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit')) || DEFAULT_LIMIT));
    const offset = (page - 1) * limit;

    const { results } = await db
      .prepare(
        `SELECT id, title, author_name, content, created_at
         FROM writings
         WHERE status = 'approved'
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all();

    // Get total count for pagination info
    const countResult = await db
      .prepare('SELECT COUNT(*) as total FROM writings WHERE status = \'approved\'')
      .first();

    // Data was sanitized on insert — serve as-is (no double-sanitization)
    const writings = results.map(row => ({
      id: row.id,
      title: row.title || '',
      author: row.author_name || 'Unknown',
      content: row.content || '',
      timestamp: row.created_at,
    }));

    return new Response(JSON.stringify({
      result: 'success',
      writings,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      },
    }), {
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
