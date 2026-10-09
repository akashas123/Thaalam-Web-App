const YOUTUBE_MUSIC_SEARCH_URL =
  'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const YOUTUBE_MUSIC_NEXT_URL =
  'https://music.youtube.com/youtubei/v1/next?prettyPrint=false&key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

function findVideoId(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.videoId === 'string') return value.videoId;
  for (const child of Object.values(value)) {
    const result = findVideoId(child);
    if (result) return result;
  }
  return '';
}

function findMusicVideoType(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.musicVideoType === 'string') return value.musicVideoType;
  for (const child of Object.values(value)) {
    const result = findMusicVideoType(child);
    if (result) return result;
  }
  return '';
}

function findPlaylistId(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.playlistId === 'string' && value.playlistId) return value.playlistId;
  for (const child of Object.values(value)) {
    const result = findPlaylistId(child);
    if (result) return result;
  }
  return '';
}

function findThumbnail(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.url === 'string' && /ytimg\.com/.test(value.url)) return value.url;
  for (const child of Object.values(value)) {
    const result = findThumbnail(child);
    if (result) return result;
  }
  return '';
}

function textRuns(column) {
  return column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
}

function collectMusicItems(value, items = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return items;
  if (Array.isArray(value)) {
    value.forEach((item) => collectMusicItems(item, items, seen));
    return items;
  }
  const renderer = value.musicResponsiveListItemRenderer;
  if (renderer) {
    const columns = renderer.flexColumns || [];
    const title = textRuns(columns[0]).map((run) => run.text || '').join('').trim();
    const metadataRuns = columns.slice(1).flatMap(textRuns);
    const metadata = metadataRuns.map((run) => run.text || '').filter(Boolean);
    const artistNames = metadataRuns.filter((run) =>
      run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
      .map((run) => run.text || '').filter(Boolean);
    const musicVideoType = findMusicVideoType(renderer);
    const topicAudio = artistNames.some((name) => /\s-\sTopic$/i.test(name)) ||
      musicVideoType === 'MUSIC_VIDEO_TYPE_ATV';
    const albumRun = metadataRuns.find((run) =>
      run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'));
    const videoId = findVideoId(renderer);
    if (videoId && title && !seen.has(videoId)) {
      seen.add(videoId);
      items.push({
        videoId,
        title,
        artist: artistNames.join(', ') || metadata[0] || '',
        album: albumRun?.text || '',
        duration: metadata.find((text) => /^\d+:\d{2}(?::\d{2})?$/.test(text)) || '',
        thumbnail: findThumbnail(renderer),
        topicAudio,
        musicVideoType,
        playlistId: findPlaylistId(renderer)
      });
    }
    return items;
  }
  Object.values(value).forEach((child) => collectMusicItems(child, items, seen));
  return items;
}

function collectQueueItems(value, items = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return items;
  if (Array.isArray(value)) {
    value.forEach((item) => collectQueueItems(item, items, seen));
    return items;
  }
  const renderer = value.playlistPanelVideoRenderer;
  if (renderer) {
    const videoId = renderer.videoId || findVideoId(renderer);
    const title = renderer.title?.runs?.map((run) => run.text || '').join('').trim() || '';
    const artistRuns = renderer.longBylineText?.runs || renderer.shortBylineText?.runs || [];
    const artist = artistRuns.map((run) => run.text || '').join('').trim();
    const musicVideoType = findMusicVideoType(renderer);
    const topicAudio = /\s-\sTopic\b/i.test(artist) || musicVideoType === 'MUSIC_VIDEO_TYPE_ATV';
    if (videoId && title && !seen.has(videoId)) {
      seen.add(videoId);
      items.push({ videoId, title, artist, thumbnail: findThumbnail(renderer), musicVideoType, topicAudio });
    }
    return items;
  }
  Object.values(value).forEach((child) => collectQueueItems(child, items, seen));
  return items;
}

async function getYouTubeMusicAutoplay(url) {
  const videoId = (url.searchParams.get('videoId') || '').trim();
  const playlistId = (url.searchParams.get('playlistId') || '').trim();
  if (!/^[\w-]{11}$/.test(videoId) || playlistId.length > 200) {
    return Response.json({ error: 'A valid video is required for autoplay.' }, { status: 400 });
  }
  const clientVersion = `1.${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.01.00`;
  let upstream;
  try {
    upstream = await fetch(YOUTUBE_MUSIC_NEXT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://music.youtube.com',
        accept: 'application/json'
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion, hl: 'en', gl: 'US' }, user: {} },
        videoId,
        playlistId: playlistId || `RDAMVM${videoId}`,
        params: 'wAEB',
        tunerSettingValue: 'AUTOMIX_SETTING_NORMAL'
      })
    });
  } catch {
    return Response.json({ error: 'YouTube Music autoplay is temporarily unavailable.' }, { status: 502 });
  }
  if (!upstream.ok) {
    return Response.json({ error: 'YouTube Music autoplay is temporarily unavailable.' }, { status: 502 });
  }
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return Response.json({ error: 'YouTube Music returned an unreadable autoplay queue.' }, { status: 502 });
  }
  return Response.json({
    playlistId: findPlaylistId(payload) || playlistId,
    results: collectQueueItems(payload).filter((item) => item.videoId !== videoId).slice(0, 50)
  }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}

async function searchYouTubeMusic(url) {
  const query = (url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  if (!query || query.length > 200) {
    return Response.json({ error: 'Enter a song title to search.' }, { status: 400 });
  }
  const clientVersion = `1.${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.01.00`;
  let upstream;
  try {
    upstream = await fetch(YOUTUBE_MUSIC_SEARCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://music.youtube.com',
        accept: 'application/json'
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB_REMIX', clientVersion, hl: 'en', gl: 'US' },
          user: {}
        },
        query,
        // YT Music's public-catalogue "Songs" filter, matching its web client.
        params: 'EgWKAQIIIAWoMEA4QChADEAQQCRAF'
      })
    });
  } catch {
    return Response.json({ error: 'YouTube Music search is temporarily unavailable.' }, { status: 502 });
  }
  if (!upstream.ok) {
    return Response.json({ error: 'YouTube Music search is temporarily unavailable.' }, { status: 502 });
  }
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return Response.json({ error: 'YouTube Music returned an unreadable response.' }, { status: 502 });
  }
  return Response.json({ results: collectMusicItems(payload).slice(0, 25) }, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' }
  });
}

async function getGoogleUser(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${match[1]}` },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user.sub === 'string' && user.sub && user.email_verified !== false ? user : null;
  } catch {
    return null;
  }
}

async function handleRatings(request, env) {
  if (!env.DB) return Response.json({ error: 'Ratings storage is not configured.' }, { status: 503 });
  const user = await getGoogleUser(request);
  if (!user) return Response.json({ error: 'Sign in with Google to sync ratings.' }, { status: 401 });

  if (request.method === 'GET') {
    let rows = null;
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
    const payload = JSON.stringify({ ratings: rows });
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
  if (request.method !== 'PUT') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
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
      const artworkInput = typeof entry.artwork === 'string' ? entry.artwork.trim().slice(0, 500) : '';
      const videoId = typeof entry.videoId === 'string' && /^[\w-]{11}$/.test(entry.videoId)
        ? entry.videoId : null;
      return env.DB.prepare(`
        INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, artwork, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id, track_key) DO UPDATE SET
          rating = excluded.rating,
          title = CASE WHEN excluded.title = '' THEN user_ratings.title ELSE excluded.title END,
          artist = CASE WHEN excluded.artist = '' THEN user_ratings.artist ELSE excluded.artist END,
          video_id = COALESCE(excluded.video_id, user_ratings.video_id),
          artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
          updated_at = unixepoch()
      `).bind(user.sub, entry.trackKey.trim(), entry.rating, title, artist, videoId, artworkInput);
    });
    try {
      if (statements.length) await env.DB.batch(statements);
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
    return Response.json({ ok: true });
  }
  if (payload.rating !== 'up' && payload.rating !== 'down') {
    return Response.json({ error: 'Rating must be up or down.' }, { status: 400 });
  }
  const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 300) : '';
  const artist = typeof payload.artist === 'string' ? payload.artist.trim().slice(0, 300) : '';
  const artwork = typeof payload.artwork === 'string' ? payload.artwork.trim().slice(0, 500) : '';
  const videoId = typeof payload.videoId === 'string' && /^[\w-]{11}$/.test(payload.videoId)
    ? payload.videoId
    : null;
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
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ratings') {
      if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      try {
        return await handleRatings(request, env);
      } catch {
        return Response.json({ error: 'Ratings storage is temporarily unavailable.' }, { status: 503 });
      }
    }
    if (url.pathname === '/api/youtube-search') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      return searchYouTubeMusic(url);
    }
    if (url.pathname === '/api/youtube-autoplay') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      return getYouTubeMusicAutoplay(url);
    }
    return env.ASSETS.fetch(request);
  }
};
