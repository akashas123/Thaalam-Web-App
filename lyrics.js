const lyricsPanel = document.getElementById('lyricsPanel');
const lyricsToggle = document.getElementById('lyricsToggle');
const lyricsSong = document.getElementById('lyricsSong');
const lyricsContent = document.getElementById('lyricsContent');
const lyricsNotice = document.getElementById('lyricsNotice');
const lyricsRadio = document.getElementById('radio');

const trackElapsed = document.getElementById('trackElapsed');
const trackDuration = document.getElementById('trackDuration');

const lyricsApi =
  'https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7';

const lrclibApi =
  'https://lrclib.net/api';

let syncedLines = [];
let currentSongId = '';
let activeLyricIndex = -1;
let lastLyricsWereSynced = false;
let hasFetchedLyrics = false;
let streamIsActive = false;
let playbackStartedOnMobile = false;
let mobileTouchStartY = 0;
let mobileTouchStartedInLyrics = false;
let lyricsLookupSongId = '';
let lyricsLookupResult = '';
let lyricsLookupRequestId = 0;
let lyricsRetryTimer = 0;
let lyricsRetrySongId = '';
let lyricsRetryCount = 0;
let lyricScrollFrame = 0;

let trackDurationSeconds = 0;
let trackElapsedSeconds = 0;
let trackElapsedSyncTime = 0;
let trackClockSongId = '';
let trackClockPlaybackSessionId = 0;

const lrclibCache = new Map();
const lrclibRequests = new Map();
const LRCLIB_STORAGE_KEY = 'thaalam-lrclib-cache-v1';
const LRCLIB_CACHE_LIMIT = 100;
const LRCLIB_BACKOFF_KEY = 'thaalam-lrclib-backoff-until-v1';
const LRCLIB_MIN_REQUEST_GAP_MS = 1500;
let lrclibLastRequestAt = 0;
let lrclibQueue = Promise.resolve();
let lrclibBlockedUntil = 0;
try {
  lrclibBlockedUntil = Number(localStorage.getItem(LRCLIB_BACKOFF_KEY)) || 0;
} catch { /* The rate-limit cooldown still works for this page session. */ }

function pauseLrclibRequestsFor(milliseconds) {
  lrclibBlockedUntil = Math.max(lrclibBlockedUntil, Date.now() + milliseconds);
  try { localStorage.setItem(LRCLIB_BACKOFF_KEY, String(lrclibBlockedUntil)); }
  catch { /* Keep the cooldown in memory when storage is unavailable. */ }
}

function waitForLrclibRequestSlot() {
  const slot = lrclibQueue.then(async () => {
    if (lrclibBlockedUntil > Date.now()) return false;
    const waitMs = Math.max(lrclibLastRequestAt + LRCLIB_MIN_REQUEST_GAP_MS - Date.now(), 0);
    if (waitMs) await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    if (lrclibBlockedUntil > Date.now()) return false;
    lrclibLastRequestAt = Date.now();
    return true;
  });
  lrclibQueue = slot.catch(() => false);
  return slot;
}

function readStoredLyricsCache() {
  try {
    const stored = JSON.parse(localStorage.getItem(LRCLIB_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return;
    for (const entry of stored) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim()) {
        lrclibCache.set(entry[0], entry[1]);
      }
    }
  } catch { /* Persistent caching is optional; the in-memory cache still works. */ }
}

function storeLyricsCacheEntry(cacheKey, lyrics) {
  // Empty responses are often temporary lookup failures. Never persist them as
  // a hit, or that song would stay lyric-less until the cache was cleared.
  if (!lyrics?.trim()) return;
  lrclibCache.delete(cacheKey);
  lrclibCache.set(cacheKey, lyrics);
  while (lrclibCache.size > LRCLIB_CACHE_LIMIT) {
    lrclibCache.delete(lrclibCache.keys().next().value);
  }
  try {
    localStorage.setItem(LRCLIB_STORAGE_KEY, JSON.stringify([...lrclibCache]));
  } catch { /* Keep the in-memory result when storage is unavailable or full. */ }
}

readStoredLyricsCache();

function parseTrackDurationSeconds(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (typeof value !== 'string' || !value.includes(':')) return 0;
  const parts = value.split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function normalizeTrackTitle(value) {
  return value
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || '';
}

function normalizeArtistName(value) {
  return normalizeTrackTitle(
    String(value || '')
      .replace(/\s*-\s*topic$/i, '')
      .split(/\s*[·•|]\s*|\s+\.\s+/)[0]
      .replace(/\s+(feat\.?|ft\.?).*$/i, '')
  );
}

function cleanLyricsSearchTitle(value) {
  return String(value || '')
    .replace(/[\[(](?:\d{4}\s*)?(?:official\s*)?(?:audio|video|lyrics|visualizer|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|(?:us|uk|indian|international)?\s*version|deluxe\s*edition|bonus\s*track)[^)\]]*[\])]/gi, '')
    .replace(/\s*[\u2012-\u2015-]\s*(?:official\s*)?(?:audio|video|lyrics|visualizer|remaster(?:ed)?|radio\s*edit|single\s*version|album\s*version|(?:us|uk|indian|international)?\s*version|deluxe\s*edition|bonus\s*track).*$/i, '')
    .trim();
}

function normalizeLyricsTitle(value) {
  return normalizeTrackTitle(cleanLyricsSearchTitle(value));
}

function lyricsArtistMatches(candidate, requested) {
  const normalizeArtists = (value) => String(value || '')
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map(normalizeArtistName)
    .filter(Boolean);
  const candidates = normalizeArtists(candidate);
  const requestedArtists = normalizeArtists(requested);
  if (!candidates.length || !requestedArtists.length) return false;
  return candidates.some((candidateName) => requestedArtists.some((requestedName) =>
    candidateName === requestedName ||
    (requestedName.length >= 4 && candidateName.includes(requestedName)) ||
    (candidateName.length >= 4 && requestedName.includes(candidateName))
  ));
}

function lyricsTitlesMatch(candidate, requested) {
  const left = normalizeLyricsTitle(candidate);
  const right = normalizeLyricsTitle(requested);
  return Boolean(left && right && (left === right ||
    (Math.min(left.length, right.length) >= 8 && (left.startsWith(right) || right.startsWith(left)))));
}

async function fetchLrclibLyrics(song) {
  if (!song?.artist || !song?.title) {
    return '';
  }

  const cacheKey =
    `${normalizeArtistName(song.artist)}|${normalizeTrackTitle(song.title)}`;
  const legacyCacheKey = `${song.artist.toLowerCase()}|${song.title.toLowerCase()}`;

  if (lrclibCache.has(cacheKey) || lrclibCache.has(legacyCacheKey)) {
    const cached = lrclibCache.get(cacheKey) || lrclibCache.get(legacyCacheKey);
    // Refresh insertion order so frequently used songs stay in the small cache.
    storeLyricsCacheEntry(cacheKey, cached);
    return cached;
  }

  if (lrclibRequests.has(cacheKey)) return lrclibRequests.get(cacheKey);

  const request = (async () => {
  try {
    if (!await waitForLrclibRequestSlot()) return '';
    const search = new URLSearchParams({
      q: `${cleanLyricsSearchTitle(song.title)} ${String(song.artist).replace(/\s*-\s*topic$/i, '').trim()}`
    });

    const response = await fetch(
      `${lrclibApi}/search?${search}`,
      {
        cache: 'default'
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        pauseLrclibRequestsFor(Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 60_000);
      } else if (response.status >= 500) {
        pauseLrclibRequestsFor(30_000);
      }
      return '';
    }

    const matches = await response.json();

    const result = matches.find((match) =>
      lyricsTitlesMatch(match.trackName, song.title) &&
      lyricsArtistMatches(match.artistName, song.artist) &&
      (match.syncedLyrics || match.plainLyrics)
    );

    const lyrics =
      result?.syncedLyrics ||
      result?.plainLyrics ||
      '';

    storeLyricsCacheEntry(cacheKey, lyrics);

    return lyrics;

  } catch (error) {
    return '';
  }
  })();
  lrclibRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (lrclibRequests.get(cacheKey) === request) lrclibRequests.delete(cacheKey);
  }
}

window.prefetchOnDemandLyrics = (track) => {
  const title = String(track?.title || track?.trackName || '').trim();
  const artist = String(track?.artist || track?.artistName || '')
    .replace(/\s-\sTopic$/i, '')
    .trim();
  if (title && artist) void fetchLrclibLyrics({ title, artist });
};

window.prefetchOnDemandLyricsQueue = (queue, currentIndex = 0, lookahead = 4) => {
  if (!Array.isArray(queue) || !queue.length) return;
  const count = Math.min(queue.length, Math.max(1, Number(lookahead) || 4));
  for (let offset = 0; offset < count; offset += 1) {
    const song = queue[currentIndex + offset];
    if (!song) break;
    window.prefetchOnDemandLyrics?.(song);
  }
};

function getAzuraCastLyrics(song) {
  const lyrics = song?.lyrics;

  if (Array.isArray(lyrics)) {
    return lyrics.join('\n').trim();
  }

  return typeof lyrics === 'string'
    ? lyrics.trim()
    : '';
}

function parseLyrics(lyrics) {
  const lines =
    lyrics.split(/\r?\n/);

  const timestampPattern =
    /\[(\d{1,2}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;

  const parsedLines = [];

  lines.forEach((line) => {
    const timestamps =
      [...line.matchAll(timestampPattern)];

    const text =
      line.replace(timestampPattern, '').trim();

    timestamps.forEach((match) => {
      const fraction =
        (match[3] || '').padEnd(3, '0');

      parsedLines.push({
        time:
          Number(match[1]) * 60 +
          Number(match[2]) +
          Number(fraction) / 1000,
        text
      });
    });
  });

  return parsedLines.sort(
    (first, second) =>
      first.time - second.time
  );
}

function renderLyrics(lyrics) {
  syncedLines = parseLyrics(lyrics);

  lyricsContent.replaceChildren();

  if (!syncedLines.length) {
    lyricsNotice.hidden = false;
    lyricsContent.textContent = lyrics;
    return;
  }

  lyricsNotice.hidden = true;

  syncedLines.forEach((line) => {
    const lineElement =
      document.createElement('div');

    lineElement.className =
      'lyrics-line';

    lineElement.textContent =
      line.text || '♪';

    lyricsContent.appendChild(
      lineElement
    );

    line.element = lineElement;
  });
}

function formatTrackTime(seconds) {
  seconds = Math.max(
    0,
    Math.floor(seconds || 0)
  );

  const hours =
    Math.floor(seconds / 3600);

  const minutes =
    Math.floor((seconds % 3600) / 60);

  const remainingSeconds =
    seconds % 60;

  if (hours > 0) {
    return (
      hours +
      ':' +
      String(minutes).padStart(2, '0') +
      ':' +
      String(remainingSeconds).padStart(2, '0')
    );
  }

  return (
    minutes +
    ':' +
    String(remainingSeconds).padStart(2, '0')
  );
}

function getAudibleTrackElapsed() {
  let elapsed = trackElapsedSeconds;
  if (streamIsActive && trackElapsedSyncTime) {
    elapsed += Math.max(
      0,
      performance.now() / 1000 - trackElapsedSyncTime
    );
  }

  return Math.max(0, elapsed);
}

window.getAudibleTrackClock = () => ({
  songId: trackClockSongId,
  elapsed: getAudibleTrackElapsed(),
  duration: trackDurationSeconds
});

function updateTrackTime() {
  if (!trackElapsed || !trackDuration) {
    return;
  }

  // On-demand playback owns the elapsed/duration readout (see
  // ondemand-player.js).
  if (window.onDemandPlaybackActive) {
    return;
  }

  // Clamp to the total duration so the live readout never counts past the
  // song's nominal length (the bar and the clock stop together at the end).
  // The raw clock stays unclamped for lyric highlighting and re-syncing.
  const rawElapsed = getAudibleTrackElapsed();
  const elapsed = trackDurationSeconds > 0
    ? Math.min(rawElapsed, trackDurationSeconds)
    : rawElapsed;

  trackElapsed.textContent =
    formatTrackTime(elapsed);

  trackDuration.textContent =
    trackDurationSeconds > 0
      ? formatTrackTime(trackDurationSeconds)
      : '0:00';
}

function updateActiveLyric(forceReveal = false) {
  const onDemand = Boolean(window.onDemandPlaybackActive);

  if (
    (!streamIsActive && !onDemand) ||
    !syncedLines.length ||
    !currentSongId
  ) {
    return;
  }

  const elapsed = onDemand
    ? Math.max(0, Number(window.getOnDemandTrackClock?.()?.elapsed) || 0)
    : getAudibleTrackElapsed();

  let activeIndex = -1;

  syncedLines.forEach(
    (line, index) => {
      if (line.time <= elapsed) {
        activeIndex = index;
      }
    }
  );

  syncedLines.forEach(
    (line, index) => {
      line.element.classList.toggle(
        'is-active',
        index === activeIndex
      );
    }
  );

  if (
    activeIndex >= 0 &&
    (forceReveal || activeIndex !== activeLyricIndex)
  ) {
    smoothlyRevealLyric(
      syncedLines[activeIndex].element
    );
  }

  activeLyricIndex =
    activeIndex;
}

window.refreshActiveLyricPosition = () => updateActiveLyric(true);

function smoothlyRevealLyric(lineElement) {
  cancelAnimationFrame(
    lyricScrollFrame
  );

  const container =
    lyricsContent;

  const lineRect =
    lineElement.getBoundingClientRect();

  const start =
    container.scrollTop;

  const destination =
    Math.max(
      0,
      start +
      lineRect.top -
      container.getBoundingClientRect().top -
      (container.clientHeight -
        lineRect.height) / 2
    );

  const distance =
    destination - start;

  if (Math.abs(distance) < 2) {
    return;
  }

  const startTime =
    performance.now();

  const duration =
    Math.min(
      900,
      Math.max(
        450,
        Math.abs(distance) * 1.2
      )
    );

  function animateScroll(now) {
    if (!streamIsActive && !window.onDemandPlaybackActive) {
      lyricScrollFrame = 0;
      return;
    }

    const progress =
      Math.min(
        1,
        (now - startTime) /
        duration
      );

    const easedProgress =
      progress < 0.5
        ? 4 *
          progress *
          progress *
          progress
        : 1 -
          Math.pow(
            -2 * progress + 2,
            3
          ) / 2;

    container.scrollTop =
      start +
      distance *
      easedProgress;

    if (progress < 1) {
      lyricScrollFrame =
        requestAnimationFrame(
          animateScroll
        );
    } else {
      lyricScrollFrame = 0;
    }
  }

  lyricScrollFrame =
    requestAnimationFrame(
      animateScroll
    );
}

function handleSongLyricsView(
  lyricsAreSynced
) {
  if (
    !window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches
  ) {
    return;
  }

  if (
    lyricsAreSynced &&
    streamIsActive &&
    !lyricsRadio.paused
  ) {
    document.body.classList.add(
      'mobile-lyrics-expanded'
    );

    lyricsToggle.setAttribute(
      'aria-expanded',
      'true'
    );

    return;
  }

  document.body.classList.remove(
    'mobile-lyrics-expanded'
  );

  lyricsToggle.setAttribute(
    'aria-expanded',
    'false'
  );

  resetMobilePlayerPosition();
}

function updateLyrics(
  data,
  refreshCurrentSong = false
) {
  const song =
    data?.now_playing?.song;

  const lyrics =
    lyricsLookupResult ||
    getAzuraCastLyrics(song);

  const nowPlaying =
    data?.now_playing;

  const songName =
    [
      song?.artist,
      song?.title
    ]
      .filter(Boolean)
      .join(' - ');

  const songId =
    song?.id ||
    songName;

  const playbackSessionId =
    Number(window.hlsPlaybackSessionId) || 0;

  const isNewPlaybackSession =
    playbackSessionId !== trackClockPlaybackSessionId;

  const isNewTrack =
    Boolean(songId) &&
    songId !== trackClockSongId;

  if (isNewTrack || isNewPlaybackSession) {
    trackClockSongId = songId;
    trackElapsedSeconds = 0;
    trackElapsedSyncTime = 0;
    trackClockPlaybackSessionId = playbackSessionId;
  }

  const elapsed =
    Number(nowPlaying?.elapsed);

  if (
    Number.isFinite(elapsed) &&
    elapsed >= 0
  ) {
    // The shared now-playing snapshot is already aligned to the HLS playhead.
    const serverElapsed = Math.max(0, elapsed);

    trackElapsedSeconds = isNewTrack || isNewPlaybackSession
      ? serverElapsed
      : Math.max(
          getAudibleTrackElapsed(),
          serverElapsed
        );

    trackElapsedSyncTime = streamIsActive
      ? performance.now() / 1000
      : 0;
  }

  const explicitDuration =
    parseTrackDurationSeconds(nowPlaying?.duration) ||
    parseTrackDurationSeconds(song?.duration) ||
    parseTrackDurationSeconds(song?.trackTimeMillis ? Number(song.trackTimeMillis) / 1000 : 0);
  const remaining = parseTrackDurationSeconds(nowPlaying?.remaining);
  const inferredDuration = remaining > 0
    ? getAudibleTrackElapsed() + remaining
    : 0;
  trackDurationSeconds = explicitDuration || inferredDuration;

  const hasLyrics =
    Boolean(lyrics);

  document.body.classList.toggle(
    'has-lyrics',
    hasLyrics
  );

  lyricsPanel.setAttribute(
    'aria-hidden',
    String(
      !hasLyrics &&
      !window.matchMedia('(min-width: 56.25rem) and (pointer: fine)').matches
    )
  );

  if (!hasLyrics) {
    lyricsSong.textContent = '';

    lyricsContent.replaceChildren();

    lyricsNotice.hidden = true;

    document.body.classList.remove(
      'mobile-lyrics-expanded'
    );

    document.body.classList.remove(
      'synced-lyrics'
    );

    lyricsToggle.setAttribute(
      'aria-expanded',
      'false'
    );

    lastLyricsWereSynced =
      false;

    resetMobilePlayerPosition();

    syncedLines = [];

    currentSongId = '';

    activeLyricIndex = -1;

    updateTrackTime();

    return;
  }

  lyricsSong.textContent =
    songName;

  const songChanged =
    songId !== currentSongId;

  if (
    songChanged ||
    refreshCurrentSong
  ) {
    if (songChanged) {
      currentSongId =
        songId;
      activeLyricIndex = -1;
      lyricsContent.scrollTop = 0;
    }

    renderLyrics(lyrics);

    const lyricsAreSynced =
      syncedLines.length > 0;

    const lyricsSyncStatusChanged =
      lastLyricsWereSynced !==
      lyricsAreSynced;

    document.body.classList.toggle(
      'synced-lyrics',
      lyricsAreSynced
    );

    lastLyricsWereSynced =
      lyricsAreSynced;

    if (
      songChanged ||
      lyricsSyncStatusChanged
    ) {
      handleSongLyricsView(
        lyricsAreSynced
      );
    }
  }

  updateActiveLyric();

  updateTrackTime();

  expandLyricsAfterPlaybackStarts();
}

async function fetchLyrics(nowPlayingData = null, forceLyricsLookup = false) {
  if (
    (!streamIsActive ||
      lyricsRadio.paused) &&
    hasFetchedLyrics &&
    !window.onDemandPlaybackActive
  ) {
    return;
  }

  try {
    let data = nowPlayingData;

    if (!data && window.onDemandPlaybackActive) {
      data = window.latestNowPlayingData || null;
    } else if (!data) {
      const response = await fetch(
        `${lyricsApi}?t=${Date.now()}`,
        { cache: 'no-store' }
      );

      if (!response.ok) return;
      data = await response.json();
    }

    hasFetchedLyrics = true;

    const song =
      data?.now_playing?.song;

    const songId =
      song?.id ||
      [
        song?.artist,
        song?.title
      ]
        .filter(Boolean)
        .join(' - ');

    if (
      songId &&
      (songId !== lyricsLookupSongId || forceLyricsLookup)
    ) {
      lyricsLookupSongId =
        songId;

      if (songId !== lyricsRetrySongId) {
        window.clearTimeout(lyricsRetryTimer);
        lyricsRetryTimer = 0;
        lyricsRetrySongId = songId;
        lyricsRetryCount = 0;
      }

      const requestId =
        ++lyricsLookupRequestId;

      if (!window.onDemandPlaybackActive) {
        // Live radio lyrics come only from Thaalam/AzuraCast.
        lyricsLookupResult = getAzuraCastLyrics(song);
        updateLyrics(data);
        return;
      }

      // On-demand metadata comes from the selected catalogue track.
      const cachedLyricsKey =
        `${normalizeArtistName(song.artist)}|${normalizeTrackTitle(song.title)}`;
      const legacyLyricsKey = `${String(song.artist || '').toLowerCase()}|${String(song.title || '').toLowerCase()}`;
      lyricsLookupResult = lrclibCache.get(cachedLyricsKey) ||
        lrclibCache.get(legacyLyricsKey) || '';
      updateLyrics(data, Boolean(lyricsLookupResult));
      const lrclibLyrics = await fetchLrclibLyrics(song);
      if (requestId !== lyricsLookupRequestId) return;

      lyricsLookupResult = lrclibLyrics;
      updateLyrics(data, true);

      window.clearTimeout(lyricsRetryTimer);
      lyricsRetryTimer = 0;
      if (!lrclibLyrics && lyricsRetryCount < 1) {
        lyricsRetryCount += 1;
        lyricsRetryTimer = window.setTimeout(() => {
          lyricsRetryTimer = 0;
          const latestSong = window.latestNowPlayingData?.now_playing?.song;
          const latestSongId = latestSong?.id || [latestSong?.artist, latestSong?.title].filter(Boolean).join(' - ');
          if (window.onDemandPlaybackActive && latestSongId === songId) {
            void fetchLyrics(window.latestNowPlayingData, true);
          }
        }, 8000);
      }

      return;
    }

    updateLyrics(data);

  } catch (error) {
    console.log(
      'Lyrics update failed:',
      error
    );
  }
}

function updateMobileLyricsVisibility() {
  const isMobile =
    window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches;

  const isExpanded =
    isMobile &&
    document.body.classList.contains(
      'mobile-lyrics-expanded'
    );

  lyricsToggle.setAttribute(
    'aria-expanded',
    String(isExpanded)
  );
}

function collapseMobileLyrics() {
  if (
    !window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches
  ) {
    return;
  }

  document.body.classList.remove(
    'mobile-lyrics-expanded'
  );

  resetMobilePlayerPosition();

  lyricsToggle.setAttribute(
    'aria-expanded',
    'false'
  );
}

function expandLyricsAfterPlaybackStarts() {
  if (
    !playbackStartedOnMobile ||
    !streamIsActive ||
    lyricsRadio.paused ||
    !document.body.classList.contains(
      'has-lyrics'
    ) ||
    !document.body.classList.contains(
      'synced-lyrics'
    )
  ) {
    return;
  }

  playbackStartedOnMobile = false;

  document.body.classList.add(
    'mobile-lyrics-expanded'
  );

  lyricsToggle.setAttribute(
    'aria-expanded',
    'true'
  );

}

function handleMobileWheel(event) {
  if (
    window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches &&
    !event.target.closest?.('#lyricsContent') &&
    event.deltaY < 0
  ) {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });
  }
}

function handleMobileTouchStart(event) {
  if (
    window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches
  ) {
    mobileTouchStartY =
      event.touches[0].clientY;
    mobileTouchStartedInLyrics =
      event.target instanceof Element &&
      Boolean(event.target.closest('#lyricsContent'));
  }
}

function handleMobileTouchEnd(event) {
  const touchEndY =
    event.changedTouches[0].clientY;

  const movedDown =
    touchEndY -
      mobileTouchStartY >
    24;

  if (
    window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches &&
    !mobileTouchStartedInLyrics &&
    movedDown &&
    window.scrollY > 48
  ) {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });
  }

  mobileTouchStartedInLyrics = false;
}

function resetMobilePlayerPosition() {
  if (
    !window.matchMedia(
      '(max-width: 56.1875rem), (pointer: coarse)'
    ).matches
  ) {
    return;
  }

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto'
  });

  requestAnimationFrame(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });
  });
}

function setStreamPlaybackState(
  isActive
) {
  const wasActive =
    streamIsActive;

  const nextActive =
    isActive &&
    !lyricsRadio.paused;

  if (wasActive && !nextActive) {
    trackElapsedSeconds = getAudibleTrackElapsed();
    trackElapsedSyncTime = 0;
  }

  streamIsActive = nextActive;

  if (streamIsActive) {
    if (!wasActive) {
      // Live radio rejoins the stream at the live edge on every resume, so hold
      // the clock at its last value until the next now-playing snapshot lands
      // (updateLyrics re-syncs both trackElapsedSeconds and the sync time).
      // Ticking from the pre-pause position would show a time that is not
      // audible. On-demand playback keeps its own clock in ondemand-player.js.
      trackElapsedSyncTime = window.onDemandPlaybackActive
        ? performance.now() / 1000
        : 0;
      playbackStartedOnMobile =
        window.matchMedia(
          '(max-width: 56.1875rem), (pointer: coarse)'
        ).matches;
    }

    if (!window.awaitingFreshHlsPosition) {
      fetchLyrics(window.latestNowPlayingData || null);
    }

    updateTrackTime();

    expandLyricsAfterPlaybackStarts();

  } else {
    playbackStartedOnMobile =
      false;

    updateTrackTime();

    cancelAnimationFrame(
      lyricScrollFrame
    );

    lyricScrollFrame = 0;
  }
}

if (
  window.matchMedia(
    '(max-width: 56.1875rem), (pointer: coarse)'
  ).matches
) {
  if (
    'scrollRestoration' in history
  ) {
    history.scrollRestoration =
      'manual';
  }

  window.scrollTo(0, 0);
}

if (window.latestNowPlayingData) {
  fetchLyrics(window.latestNowPlayingData);
}

window.addEventListener('thaalam:nowplaying', (event) => {
  window.awaitingFreshHlsPosition = false;
  fetchLyrics(event.detail);
});

setInterval(() => {
  if (!lyricsRadio.paused || window.onDemandPlaybackActive) {
    updateActiveLyric();
    updateTrackTime();
  }
}, 250);

lyricsRadio.addEventListener(
  'playing',
  () => setStreamPlaybackState(true)
);

lyricsRadio.addEventListener(
  'pause',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'waiting',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'stalled',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'error',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'abort',
  () => setStreamPlaybackState(false)
);

window.addEventListener(
  'scroll',
  updateMobileLyricsVisibility,
  { passive: true }
);

window.addEventListener(
  'resize',
  updateMobileLyricsVisibility
);

window.addEventListener(
  'wheel',
  handleMobileWheel,
  { passive: true }
);

window.addEventListener(
  'touchstart',
  handleMobileTouchStart,
  { passive: true }
);

window.addEventListener(
  'touchend',
  handleMobileTouchEnd,
  { passive: true }
);

lyricsToggle.addEventListener(
  'click',
  collapseMobileLyrics
);

updateMobileLyricsVisibility();
