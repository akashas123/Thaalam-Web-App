async function getGoogleUser(request) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${match[1]}` },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user.sub === 'string' && user.sub && user.email_verified !== false
      ? user
      : null;
  } catch {
    return null;
  }
}

export async function handleRatings(request, env) {
  if (!env.DB) {
    return Response.json({ error: 'Ratings storage is not configured.' }, { status: 503 });
  }
  const user = await getGoogleUser(request);
  if (!user) return Response.json({ error: 'Sign in with Google to sync ratings.' }, { status: 401 });

  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT track_key, rating, title, artist, video_id FROM user_ratings WHERE user_id = ? ORDER BY updated_at DESC'
    ).bind(user.sub).all();
    const ratings = result.results || [];
    const payload = JSON.stringify({ ratings });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const etag = `"${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}"`;
    const headers = { 'Cache-Control': 'no-store', ETag: etag };
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    return new Response(payload, { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const trackKey = typeof payload.trackKey === 'string' ? payload.trackKey.trim() : '';
  if (request.method === 'DELETE' && Array.isArray(payload.trackKeys)) {
    if (payload.trackKeys.length > 500 || payload.trackKeys.some((key) =>
      typeof key !== 'string' || !key.trim() || key.trim().length > 300)) {
      return Response.json({ error: 'Invalid track keys.' }, { status: 400 });
    }
    if (payload.trackKeys.length) {
      await env.DB.batch(payload.trackKeys.map((key) => env.DB.prepare(
        'DELETE FROM user_ratings WHERE user_id = ? AND track_key = ?'
      ).bind(user.sub, key.trim())));
    }
    return Response.json({ ok: true });
  }
  if (!Array.isArray(payload.ratings) && (!trackKey || trackKey.length > 300)) {
    return Response.json({ error: 'A valid track key is required.' }, { status: 400 });
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM user_ratings WHERE user_id = ? AND track_key = ?')
      .bind(user.sub, trackKey).run();
    return Response.json({ ok: true });
  }
  if (request.method !== 'PUT') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }
  if (Array.isArray(payload.ratings)) {
    if (payload.ratings.length > 500) {
      return Response.json({ error: 'Too many ratings in one request.' }, { status: 400 });
    }
    for (const entry of payload.ratings) {
      if (!entry || typeof entry.trackKey !== 'string' || !entry.trackKey.trim() ||
          entry.trackKey.trim().length > 300 || (entry.rating !== 'up' && entry.rating !== 'down')) {
        return Response.json({ error: 'Invalid rating entry.' }, { status: 400 });
      }
    }
    const statements = payload.ratings.map((entry) => {
      const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 300) : '';
      const artist = typeof entry.artist === 'string' ? entry.artist.trim().slice(0, 300) : '';
      const videoId = typeof entry.videoId === 'string' && /^[\w-]{11}$/.test(entry.videoId)
        ? entry.videoId
        : null;
      return env.DB.prepare(`
        INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, track_key) DO UPDATE SET
          rating = excluded.rating, title = excluded.title, artist = excluded.artist,
          video_id = excluded.video_id, updated_at = unixepoch()
      `).bind(user.sub, entry.trackKey.trim(), entry.rating, title, artist, videoId);
    });
    if (statements.length) await env.DB.batch(statements);
    return Response.json({ ok: true });
  }
  if (payload.rating !== 'up' && payload.rating !== 'down') {
    return Response.json({ error: 'Rating must be up or down.' }, { status: 400 });
  }
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 300) : '';
  const artist = typeof payload.artist === 'string' ? payload.artist.trim().slice(0, 300) : '';
  const videoId = typeof payload.videoId === 'string' && /^[\w-]{11}$/.test(payload.videoId)
    ? payload.videoId
    : null;
  await env.DB.prepare(`
    INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, track_key) DO UPDATE SET
      rating = excluded.rating,
      title = excluded.title,
      artist = excluded.artist,
      video_id = excluded.video_id,
      updated_at = unixepoch()
  `).bind(user.sub, trackKey, payload.rating, title, artist, videoId).run();
  return Response.json({ ok: true });
}
