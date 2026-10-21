/* JioSaavn on-demand backend (self-contained copy of music-api.mjs for
   the Direct-Upload worker bundle). Proxies JioSaavn's internal web API (it
   blocks browser CORS), decrypts the DES-ECB wrapped media URLs, and returns
   one stable song shape to the client:
     { id, title, artist, album, duration, durationSeconds, thumbnail,
       streamUrl, permalink }
   The endpoints are undocumented and can change without notice. */

const UPSTREAM_API_URL = 'https://www.jiosaavn.com/api.php';
const UPSTREAM_REQUEST_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*'
};
const SONG_ID_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

/* DES-ECB decryption (key 38346591) for encrypted_media_url, implemented in
   plain JS because Workers do not expose DES through their crypto APIs. */
const DES_PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const DES_PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const DES_SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const DES_IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const DES_FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const DES_E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const DES_P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const DES_SBOX = [
  [[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7],[0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8],[4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0],[15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13]],
  [[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10],[3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5],[0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15],[13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9]],
  [[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8],[13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1],[13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7],[1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12]],
  [[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15],[13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9],[10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4],[3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14]],
  [[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9],[14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6],[4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14],[11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3]],
  [[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11],[10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8],[9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6],[4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13]],
  [[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1],[13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6],[1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2],[6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12]],
  [[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7],[1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2],[7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8],[2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]]
];

function desBitsOf(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >> bit) & 1);
  }
  return bits;
}

function desBytesOf(bits) {
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  return out;
}

function desPermute(bits, table) {
  return table.map((index) => bits[index - 1]);
}

function desRotateLeft(bits, count) {
  return bits.slice(count).concat(bits.slice(0, count));
}

function desKeyRounds(keyBytes) {
  const key = desPermute(desBitsOf(keyBytes), DES_PC1);
  let left = key.slice(0, 28);
  let right = key.slice(28, 56);
  const rounds = [];
  for (let round = 0; round < 16; round += 1) {
    left = desRotateLeft(left, DES_SHIFTS[round]);
    right = desRotateLeft(right, DES_SHIFTS[round]);
    rounds.push(desPermute(left.concat(right), DES_PC2));
  }
  return rounds;
}

function desProcessBlock(block, rounds) {
  let bits = desPermute(desBitsOf(block), DES_IP);
  let left = bits.slice(0, 32);
  let right = bits.slice(32, 64);
  for (let round = 0; round < 16; round += 1) {
    const expanded = desPermute(right, DES_E).map((bit, index) => bit ^ rounds[round][index]);
    const substituted = [];
    for (let box = 0; box < 8; box += 1) {
      const chunk = expanded.slice(box * 6, box * 6 + 6);
      const row = (chunk[0] << 1) | chunk[5];
      const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4];
      const value = DES_SBOX[box][row][col];
      substituted.push((value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1);
    }
    const permuted = desPermute(substituted, DES_P);
    const nextRight = left.map((bit, index) => bit ^ permuted[index]);
    left = right;
    right = nextRight;
  }
  return Uint8Array.from(desBytesOf(desPermute(right.concat(left), DES_FP)));
}

/* Decrypts a JioSaavn encrypted_media_url and pulls the absolute URL out of
   the plaintext (which can carry trailing PKCS padding). Uses only web APIs
   (atob/String.fromCharCode) so the same code runs in Workers and Node. */
function decryptMediaUrl(encrypted) {
  if (typeof encrypted !== 'string' || !encrypted) return '';
  let data;
  try {
    const normalized = encrypted.replace(/-/g, '+').replace(/_/g, '/');
    const binary = globalThis.atob(normalized);
    data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return '';
  }
  if (!data.length || data.length % 8 !== 0) return '';
  const key = Uint8Array.from('38346591', (char) => char.charCodeAt(0));
  // ECB decryption is the Feistel cipher with the key schedule reversed.
  const rounds = desKeyRounds(key).reverse();
  const out = [];
  for (let offset = 0; offset < data.length; offset += 8) {
    out.push(...desProcessBlock(data.slice(offset, offset + 8), rounds));
  }
  let plaintext = '';
  for (let offset = 0; offset < out.length; offset += 4096) {
    plaintext += String.fromCharCode(...out.slice(offset, offset + 4096));
  }
  // PKCS padding bytes (all below 0x20) trail the URL; strip them off.
  return selectMediaUrl(plaintext);
}

/* Picks the playback URL out of the decrypted plaintext.
   JioSaavn hands back a single CDN URL pinned to a low rendition, e.g.
   https://aac.saavncdn.com/450/<hash>_96.mp4, but the CDN keeps every quality
   under the same hash, so bump the bitrate to 320 kbps for high-quality
   playback instead of the 96 kbps stream. Only the trailing _<bitrate> right
   before the media extension is rewritten, leaving the hash itself untouched.
 */
function selectMediaUrl(plaintext) {
  if (!plaintext) return '';

  const match = plaintext.match(/https?:\/\/[^\s"'\\;]+/);
  if (!match) return '';

  // PKCS padding bytes (all below 0x20) trail the URL; strip them off.
  const url = match[0].replace(/[\u0000-\u001f]+$/g, '');
  if (!url) return '';

  // Upgrade _96/_128/_160/... to _320; an already-320 URL is returned as-is.
  return url.replace(/_(\d{2,3})(\.(?:mp4|m4a|mp3))$/i, (whole, bitrate, ext) =>
    Number(bitrate) >= 320 ? whole : `_320${ext}`);
}

/* JioSaavn answers api.php with plain JSON (or a marker-prefixed blob), never
   reliably parseable as-is. */
function parseProviderPayload(text) {
  const objectIndex = text.indexOf('{');
  const arrayIndex = text.indexOf('[');
  const start = objectIndex === -1 ? arrayIndex
    : arrayIndex === -1 ? objectIndex
      : Math.min(objectIndex, arrayIndex);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

async function callProviderApi(call, params, ctx = 'web6dot0', env = {}) {
  const url = new URL(UPSTREAM_API_URL);
  url.searchParams.set('__call', call);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('_format', 'json');
  url.searchParams.set('_marker', '0');
  url.searchParams.set('ctx', ctx);
  url.searchParams.set('api_version', '4');
  const relayUrl = env.JIOSAAVN_RELAY_URL;
  const targetUrl = relayUrl ? new URL(url.search, relayUrl).toString() : url;
  const headers = relayUrl
    ? { ...UPSTREAM_REQUEST_HEADERS, 'x-relay-token': env.JIOSAAVN_RELAY_TOKEN || '' }
    : UPSTREAM_REQUEST_HEADERS;
  const response = await fetch(targetUrl, { headers });
  if (!response.ok) return null;
  return parseProviderPayload(await response.text());
}

/* Titles occasionally arrive with markup/entities; keep plain text only. */
function sanitizeText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${minutes}:${pad(rest)}`;
}

/* Normalises any JioSaavn song-shaped payload (search results, song details,
   album lists, artist top songs) into the single client-facing shape. */
function mapProviderSong(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  const title = sanitizeText(raw.title);
  if (!SONG_ID_PATTERN.test(id) || !title) return null;

  const info = raw.more_info || {};
  const subtitle = sanitizeText(raw.subtitle);
  const separator = subtitle.lastIndexOf(' - ');
  const album = sanitizeText(info.album) ||
    (separator !== -1 ? subtitle.slice(separator + 3) : '');
  const artistNames = (info.artistMap?.primary_artists || [])
    .map((artist) => sanitizeText(artist.name))
    .filter(Boolean);
  const artistIds = (info.artistMap?.primary_artists || [])
    .map((artist) => String(artist.id || ''))
    .filter(Boolean);
  const artist = artistNames.join(', ') ||
    (separator !== -1 ? subtitle.slice(0, separator) : subtitle);

  const durationSeconds = Math.max(0, Math.floor(Number(info.duration) || 0));
  const thumbnail = String(raw.image || '')
    .replace(/^http:/, 'https:')
    .replace(/150x150|50x50/, '500x500');
  const streamUrl = decryptMediaUrl(info.encrypted_media_url);

  return {
    id,
    title,
    artist,
    artistIds,
    album,
    albumId: String(info.album_id || ''),
    duration: formatDuration(durationSeconds),
    durationSeconds,
    thumbnail,
    streamUrl,
    permalink: String(raw.perma_url || '')
  };
}

function providerErrorResponse(message, status = 502) {
  return Response.json({ error: message }, { status });
}

function isValidSongId(id) {
  return typeof id === 'string' && SONG_ID_PATTERN.test(id);
}

function readSongId(url) {
  return (url.searchParams.get('id') || '').trim();
}

/* GET /api/music-search?q=<query>&limit=<1-25>
   Returns ranked-by-relevance catalogue songs with resolved stream URLs.
   Pages through JioSaavn result pages (p=1, 2, ...) so the caller actually
   receives up to `limit` playable songs instead of one thin page. */
async function handleSearch(request, env = {}) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  if (!query || query.length > 200) {
    return Response.json({ error: 'Enter a song title to search.' }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit')) || 10));

  const seen = new Set();
  const results = [];
  try {
    // JioSaavn rarely honours n=25 on page one; walk pages until the grid is
    // full (or pages run dry) so genre tabs fill all 21 cards.
    for (let page = 1; page <= 5 && results.length < limit; page += 1) {
      const payload = await callProviderApi('search.getResults', { q: query, n: String(Math.max(limit, 10)), p: String(page) }, 'web6dot0', env);
      const raw = payload?.data?.results || payload?.results || [];
      const items = Array.isArray(raw) ? raw : [];
      if (!items.length) break;
      for (const item of items) {
        const mapped = mapProviderSong(item);
        // A song without a decryptable stream URL is unplayable; skip it rather
        // than letting the client rank it and fail at play time.
        if (mapped && mapped.streamUrl && !seen.has(mapped.id)) {
          seen.add(mapped.id);
          results.push(mapped);
          if (results.length >= limit) break;
        }
      }
      // Last page: fewer fresh songs than requested means nothing more to fetch.
      if (items.length < 10) break;
    }
  } catch {
    return providerErrorResponse('JioSaavn search is temporarily unavailable.');
  }
  if (!results.length) {
    return providerErrorResponse('JioSaavn search is temporarily unavailable.');
  }

  return Response.json({ results: results.slice(0, 25) }, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' }
  });
}

/* GET /api/music-song?id=<songId>
   Fresh stream resolution for a known song (used to recover expired URLs). */
async function handleSong(request, env = {}) {
  const url = new URL(request.url);
  const id = readSongId(url);
  if (!isValidSongId(id)) {
    return Response.json({ error: 'A valid song is required.' }, { status: 400 });
  }

  let payload = null;
  try {
    payload = await callProviderApi('song.getDetails', { cc: '1', pids: id }, 'web6dot0', env);
  } catch {
    return providerErrorResponse('JioSaavn song details are temporarily unavailable.');
  }
  const song = mapProviderSong(payload?.songs?.[0]);
  if (!song || !song.streamUrl) {
    return providerErrorResponse('JioSaavn song details are temporarily unavailable.');
  }
  return Response.json({ results: [song] }, {
    headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' }
  });
}

/* JioSaavn song radio: create a station for the given song, then return the
   next batch of similar songs from that station. JioSaavn's web-radio endpoint
   is stateless (repeated getSong calls return the same first batch), so each
   autoplay request builds a fresh station around the requested song. The
   client de-duplicates against playedTrackIds, so chained stations keep the
   radio moving without repeating the session's played tracks. */
async function fetchProviderRadioSongs(id, k, env = {}) {
  let stationid = null;
  try {
    const stationPayload = await callProviderApi(
      'webradio.createEntityStation',
      { entity_type: 'queue', entity_id: JSON.stringify([id]) },
      'android', env
    );
    stationid = (stationPayload && stationPayload.stationid) || null;
  } catch {
    stationid = null;
  }
  if (!stationid) return { stationid: null, songs: [] };

  let songPayload = null;
  try {
    songPayload = await callProviderApi(
      'webradio.getSong',
      { stationid, k: String(k) },
      'android', env
    );
  } catch {
    songPayload = null;
  }
  if (!songPayload) return { stationid, songs: [] };

  /* web-radio responses are shaped as either
     { stationid, song } (single) or
     { stationid, 0: { song }, 1: { song }, ... } (multiple). */
  const collectSongs = (obj, out, seen) => {
    if (!obj || typeof obj !== 'object') return;
    const visit = (song) => {
      if (!song || !song.id) return;
      const mapped = mapProviderSong(song);
      if (mapped && mapped.streamUrl && !seen.has(mapped.id)) {
        seen.add(mapped.id);
        out.push(mapped);
      }
    };
    if (obj.song) visit(obj.song);
    for (const key of Object.keys(obj)) {
      if (key === 'stationid' || key === 'error') continue;
      const value = obj[key];
      if (value && typeof value === 'object' && value.song) visit(value.song);
    }
  };

  const songs = [];
  const seen = new Set();
  collectSongs(songPayload, songs, seen);
  return { stationid, songs: songs.slice(0, k) };
}

/* GET /api/music-autoplay?id=<songId>&k=<1-50>
   Build each continuation from a fresh provider radio station. */
async function handleAutoplay(request, env = {}) {
  const url = new URL(request.url);
  const id = readSongId(url);
  if (!isValidSongId(id)) {
    return Response.json({ error: 'A valid song is required for autoplay.' }, { status: 400 });
  }
  const k = Math.max(1, Math.min(50, Number(url.searchParams.get('k')) || 30));

  const radio = await fetchProviderRadioSongs(id, k, env);
  return Response.json(
    { results: radio.songs, stationid: radio.stationid || undefined },
    { headers: { 'Cache-Control': 'no-store' } }
  );
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
      const album = typeof entry.album === 'string' ? entry.album.trim().slice(0, 300) : '';
      const providerTrackId = typeof entry.providerTrackId === 'string' ? entry.providerTrackId.trim().slice(0, 200) : '';
      const artworkInput = typeof entry.artwork === 'string' ? entry.artwork.trim().slice(0, 500) : '';
      const videoId = typeof entry.videoId === 'string' && /^[\w-]{11}$/.test(entry.videoId)
        ? entry.videoId : null;
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
    INSERT INTO user_ratings (user_id, track_key, rating, title, artist, video_id, artwork, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, track_key) DO UPDATE SET
      rating = excluded.rating,
      title = CASE WHEN excluded.title = '' THEN user_ratings.title ELSE excluded.title END,
      artist = CASE WHEN excluded.artist = '' THEN user_ratings.artist ELSE excluded.artist END,
      video_id = COALESCE(excluded.video_id, user_ratings.video_id),
      artwork = CASE WHEN excluded.artwork = '' THEN user_ratings.artwork ELSE excluded.artwork END,
      updated_at = unixepoch()
  `);
  // Use the extended schema when migration 0003 is present; keep the old
  // artwork schema usable during a rolling deploy.
  try {
    await env.DB.prepare(`
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
    `).bind(user.sub, trackKey, payload.rating, title, artist, videoId, artwork, providerTrackId, album).run();
  } catch {
    try {
      await withProviderIdentity.bind(user.sub, trackKey, payload.rating, title, artist, videoId, artwork).run();
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
    if (url.pathname === '/api/music-search') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      return handleSearch(request, env);
    }
    if (url.pathname === '/api/music-autoplay') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      return handleAutoplay(request, env);
    }
    if (url.pathname === '/api/music-song') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      return handleSong(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
