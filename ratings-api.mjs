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
    let rows = null;
    // Probe progressively so deployments can migrate without taking ratings offline.
    try {
      const result = await env.DB.prepare(
        'SELECT track_key, rating, title, artist, track_id, artwork, album FROM user_ratings WHERE user_id = ? ORDER BY updated_at DESC'
      ).bind(user.sub).all();
      rows = result.results || [];
    } catch {
      try {
        const result = await env.DB.prepare(
          'SELECT track_key, rating, title, artist, video_id, artwork FROM user_ratings WHERE user_id = ? ORDER BY updated_at DESC'
        ).bind(user.sub).all();
        rows = result.results || [];
      } catch {
        const result = await env.DB.prepare(
          'SELECT track_key, rating, title, artist, video_id FROM user_ratings WHERE user_id = ? ORDER BY updated_at DESC'
        ).bind(user.sub).all();
        rows = result.results || [];
      }
    }
    const ratings = rows.map((row) => ({
      ...row,
      track_id: row.track_id || row.provider_track_id || row.video_id || ''
    }));
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
      const album = typeof entry.album === 'string' ? entry.album.trim().slice(0, 300) : '';
      const providerTrackId = typeof entry.providerTrackId === 'string' ? entry.providerTrackId.trim().slice(0, 200) : '';
      const artworkInput = typeof entry.artwork === 'string' ? entry.artwork.trim().slice(0, 500) : '';
      const videoId = typeof entry.videoId === 'string' && /^[\w-]{11}$/.test(entry.videoId)
        ? entry.videoId
        : null;
      const trackId = (typeof entry.trackId === 'string' ? entry.trackId.trim().slice(0, 200) : '') ||
        providerTrackId || videoId || (entry.trackKey.startsWith('youtube:') ? entry.trackKey.slice(8) : '');
      return env.DB.prepare(`
        INSERT INTO user_ratings (user_id, track_key, rating, title, artist, track_id, artwork, album, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, track_key) DO UPDATE SET
          rating = excluded.rating,
          title = CASE WHEN excluded.title = '' THEN user_ratings.title ELSE excluded.title END,
          artist = CASE WHEN excluded.artist = '' THEN user_ratings.artist ELSE excluded.artist END,
          track_id = CASE WHEN excluded.track_id = '' THEN user_ratings.track_id ELSE excluded.track_id END,
          artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
          album = CASE WHEN excluded.album = '' THEN user_ratings.album ELSE excluded.album END,
          updated_at = unixepoch()
      `).bind(user.sub, entry.trackKey.trim(), entry.rating, title, artist, trackId, artworkInput, album);
    });
    try {
      if (statements.length) await env.DB.batch(statements);
    } catch {
      const artworkStatements = payload.ratings.map((entry) => {
        const legacyTitle = typeof entry.title === 'string' ? entry.title.trim().slice(0, 300) : '';
        const legacyArtist = typeof entry.artist === 'string' ? entry.artist.trim().slice(0, 300) : '';
        const artworkInput = typeof entry.artwork === 'string' ? entry.artwork.trim().slice(0, 500) : '';
        const legacyVideoId = typeof entry.videoId === 'string' ? entry.videoId : null;
        return env.DB.prepare(`
        INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, artwork, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, track_key) DO UPDATE SET
          rating = excluded.rating, title = excluded.title, artist = excluded.artist,
          video_id = excluded.video_id,
          artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
          updated_at = unixepoch()
      `).bind(user.sub, entry.trackKey.trim(), entry.rating, legacyTitle, legacyArtist, legacyVideoId, artworkInput);
      });
      try {
        if (artworkStatements.length) await env.DB.batch(artworkStatements);
      } catch {
        const legacy = payload.ratings.map((entry) => {
          const legacyTitle = typeof entry.title === 'string' ? entry.title.trim().slice(0, 300) : '';
          const legacyArtist = typeof entry.artist === 'string' ? entry.artist.trim().slice(0, 300) : '';
          const legacyVideoId = typeof entry.videoId === 'string' ? entry.videoId : null;
          return env.DB.prepare(`
            INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, unixepoch())
            ON CONFLICT(user_id, track_key) DO UPDATE SET
              rating = excluded.rating, title = excluded.title, artist = excluded.artist,
              video_id = excluded.video_id, updated_at = unixepoch()
          `).bind(user.sub, entry.trackKey.trim(), entry.rating, legacyTitle, legacyArtist, legacyVideoId);
        });
        if (legacy.length) await env.DB.batch(legacy);
      }
    }
    return Response.json({ ok: true });
  }
  if (payload.rating !== 'up' && payload.rating !== 'down') {
    return Response.json({ error: 'Rating must be up or down.' }, { status: 400 });
  }
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 300) : '';
  const artist = typeof payload.artist === 'string' ? payload.artist.trim().slice(0, 300) : '';
  const album = typeof payload.album === 'string' ? payload.album.trim().slice(0, 300) : '';
  const providerTrackId = typeof payload.providerTrackId === 'string' ? payload.providerTrackId.trim().slice(0, 200) : '';
  const artwork = typeof payload.artwork === 'string' ? payload.artwork.trim().slice(0, 500) : '';
  const videoId = typeof payload.videoId === 'string' && /^[\w-]{11}$/.test(payload.videoId)
    ? payload.videoId
    : null;
  const trackId = (typeof payload.trackId === 'string' ? payload.trackId.trim().slice(0, 200) : '') ||
    providerTrackId || videoId || (trackKey.startsWith('youtube:') ? trackKey.slice(8) : '');
  try {
    await env.DB.prepare(`
      INSERT INTO user_ratings (user_id, track_key, rating, title, artist, track_id, artwork, album, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, track_key) DO UPDATE SET
        rating = excluded.rating,
        title = CASE WHEN excluded.title = '' THEN user_ratings.title ELSE excluded.title END,
        artist = CASE WHEN excluded.artist = '' THEN user_ratings.artist ELSE excluded.artist END,
        track_id = CASE WHEN excluded.track_id = '' THEN user_ratings.track_id ELSE excluded.track_id END,
        artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
        album = CASE WHEN excluded.album = '' THEN user_ratings.album ELSE excluded.album END,
        updated_at = unixepoch()
    `).bind(user.sub, trackKey, payload.rating, title, artist, trackId, artwork, album).run();
    return Response.json({ ok: true });
  } catch { /* Support older schemas during the database column rename. */ }
  const withProviderIdentity = env.DB.prepare(`
    INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, artwork, provider_track_id, album, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, track_key) DO UPDATE SET
      rating = excluded.rating,
      title = CASE WHEN excluded.title = '' THEN user_ratings.title ELSE excluded.title END,
      artist = CASE WHEN excluded.artist = '' THEN user_ratings.artist ELSE excluded.artist END,
      video_id = COALESCE(excluded.video_id, user_ratings.video_id),
      artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
      provider_track_id = CASE WHEN excluded.provider_track_id = '' THEN user_ratings.provider_track_id ELSE excluded.provider_track_id END,
      album = CASE WHEN excluded.album = '' THEN user_ratings.album ELSE excluded.album END,
      updated_at = unixepoch()
  `).bind(user.sub, trackKey, payload.rating, title, artist, videoId, artwork, providerTrackId, album);
  try {
    await withProviderIdentity.run();
  } catch {
    try {
      await env.DB.prepare(`
        INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, artwork, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, track_key) DO UPDATE SET
          rating = excluded.rating,
          title = CASE WHEN excluded.title = '' THEN user_ratings.title ELSE excluded.title END,
          artist = CASE WHEN excluded.artist = '' THEN user_ratings.artist ELSE excluded.artist END,
          video_id = COALESCE(excluded.video_id, user_ratings.video_id),
          artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
          updated_at = unixepoch()
      `).bind(user.sub, trackKey, payload.rating, title, artist, videoId, artwork).run();
    } catch {
      await env.DB.prepare(`
        INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, track_key) DO UPDATE SET
          rating = excluded.rating, title = excluded.title, artist = excluded.artist,
          video_id = COALESCE(excluded.video_id, user_ratings.video_id), updated_at = unixepoch()
      `).bind(user.sub, trackKey, payload.rating, title, artist, videoId).run();
    }
  }
  return Response.json({ ok: true });
}
