const YOUTUBE_MUSIC_SEARCH_URL =
  'https://music.youtube.com/youtubei/v1/search?prettyPrint=false&key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

function findVideoId(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.videoId === 'string') return value.videoId;
  for (const child of Object.values(value)) {
    const result = findVideoId(child);
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
        topicChannel: false
      });
    }
    return items;
  }
  Object.values(value).forEach((child) => collectMusicItems(child, items, seen));
  return items;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/youtube-search') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      }
      return searchYouTubeMusic(url);
    }
    return env.ASSETS.fetch(request);
  }
};
