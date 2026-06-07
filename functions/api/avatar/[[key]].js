/**
 * GET /api/avatar/[key] — Serve Profile Pictures from R2
 * 
 * This endpoint serves profile pictures stored in R2.
 * The URL pattern is: /api/avatar/profiles/{trainer_id}.{ext}
 * 
 * Using a Worker endpoint (instead of R2 public URL) gives us:
 * 1. No need to enable R2.dev public access
 * 2. Ability to add caching headers
 * 3. Ability to restrict access to only /profiles/ prefix
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const bucket = env.BUCKET;

  // params.key comes from the [key] in the file path
  // e.g. /api/avatar/profiles/900478090080.png → key = "profiles/900478090080.png"
  const key = params.key;

  // Security: only allow fetching from the profiles/ prefix
  if (!key || !key.startsWith('profiles/')) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const object = await bucket.get(key);

    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Cache-Control', 'public, max-age=86400'); // Cache for 24h
    headers.set('ETag', object.httpETag);

    // Use the stored content type, or default
    const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
    headers.set('Content-Type', contentType);

    return new Response(object.body, { headers });

  } catch (error) {
    console.error('R2 fetch error:', error.message);
    return new Response('Internal error', { status: 500 });
  }
}
