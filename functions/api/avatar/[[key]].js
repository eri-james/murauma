/**
 * GET /api/avatar/[trainerId] — Serve Profile Pictures from D1
 * 
 * This endpoint serves profile pictures stored as base64 in the D1 members table.
 * The URL pattern is: /api/avatar/{trainer_id}
 * 
 * Example: /api/avatar/900478090080 → returns the member's profile picture as a JPEG/PNG/etc.
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
  // e.g. /api/avatar/900478090080 → key = ["900478090080"]
  const keyParts = params.key;
  const trainerId = Array.isArray(keyParts) ? keyParts[0] : keyParts;

  // Validate trainer ID format (must be 12 digits)
  if (!trainerId || !/^\d{12}$/.test(trainerId)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const member = await db
      .prepare('SELECT profile_picture_data, profile_picture_mime FROM members WHERE trainer_id = ?')
      .bind(trainerId)
      .first();

    if (!member || !member.profile_picture_data) {
      return new Response('Not found', { status: 404 });
    }

    // Decode base64 to binary
    const binary = Uint8Array.from(atob(member.profile_picture_data), c => c.charCodeAt(0));

    // Generate ETag from content hash (first 8 chars of base64 is enough for change detection)
    const etag = `"${trainerId}-${binary.length}-${member.profile_picture_data.substring(0, 16).replace(/[^a-zA-Z0-9]/g, '')}"`;

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
