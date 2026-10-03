export async function onRequest({ request, env }) {
  const apiOrigin = env.API_ORIGIN;
  if (!apiOrigin) {
    return Response.json({ error: 'API_ORIGIN is not configured.' }, { status: 503 });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }

  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, apiOrigin);

  try {
    return await fetch(target, {
      method: request.method,
      headers: request.headers,
    });
  } catch (error) {
    console.error('YouTube API proxy failed:', error);
    return Response.json({ error: 'The on-demand API is unavailable.' }, { status: 502 });
  }
}
