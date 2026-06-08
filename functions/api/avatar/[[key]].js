/**
 * GET /api/avatar/[key] — Serve Profile Pictures from D1
 * 
 * Supports two lookup methods:
 *   /api/avatar/{trainer_id}  — 12-digit trainer ID (backward compatible)
 *   /api/avatar/{member_id}   — numeric member ID (for users without trainer_id)
 * 
 * Performance features:
 * - ETag support for conditional requests (304 Not Modified)
 * - 24-hour Cache-Control for browser/CDN caching
 * - Content-Length header for proper streaming
 */
export async function onRequestGet(context) {
  const { env, params, request } = context;
  const db = env.DB;

  // params comes from [[key]] in the file path
  const keyParts = params.key;
  const key = Array.isArray(keyParts) ? keyParts[0] : keyParts;

  if (!key) {
    return new Response('Not found', { status: 404 });
  }

  let member = null;

  // Route based on key format:
  // - 12-digit number → trainer_id lookup
  // - Other number → member id lookup
  if (/^\d{12}$/.test(key)) {
    // Trainer ID lookup (backward compatible)
    member = await db
      .prepare('SELECT id, trainer_id, profile_picture_data, profile_picture_mime FROM members WHERE trainer_id = ?')
      .bind(key)
      .first();
  } else if (/^\d+$/.test(key)) {
    // Member ID lookup
    member = await db
      .prepare('SELECT id, trainer_id, profile_picture_data, profile_picture_mime FROM members WHERE id = ?')
      .bind(parseInt(key, 10))
      .first();
  }

  if (!member || !member.profile_picture_data) {
    return new Response('Not found', { status: 404 });
  }

  try {
    // Decode base64 to binary
    const binary = Uint8Array.from(atob(member.profile_picture_data), c => c.charCodeAt(0));

    // Generate ETag from content hash
    const memberId = member.id;
    const etag = `"${memberId}-${binary.length}-${member.profile_picture_data.substring(0, 16).replace(/[^a-zA-Z0-9]/g, '')}"`;

    // Check If-None-Match for 304 Not Modified
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    const headers = new Headers();
    headers.set('Content-Type', member.profile_picture_mime || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=86400'); // Cache for 24h
    headers.set('ETag', etag);
    headers.set('Content-Length', binary.length.toString());

    return new Response(binary, { headers });

  } catch (error) {
    console.error('Avatar fetch error:', error.message);
    return new Response('Internal error', { status: 500 });
  }
}
