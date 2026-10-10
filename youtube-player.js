const onDemandMount = document.getElementById('onDemandPlayerMount');
const onDemandFrame = document.getElementById('onDemandPlayerFrame');
const onDemandArtwork = document.getElementById('albumArtImg');
const onDemandStation = document.getElementById('stationName');
const onDemandTrack = document.getElementById('nowPlaying');
const onDemandModeLabel = document.querySelector('.live-text');
const returnToLiveButton = document.getElementById('returnToLiveButton');
const onDemandPlayButton = document.getElementById('playButton');
const onDemandMiniToggle = document.getElementById('miniPlayerToggle');
const onDemandElapsed = document.getElementById('trackElapsed');
const onDemandDuration = document.getElementById('trackDuration');
const onDemandMiniTitle = document.getElementById('miniPlayerTitle');
const onDemandMiniArtist = document.getElementById('miniPlayerArtist');
const nowPlayingSubtitle = document.getElementById('nowPlayingSubtitle');
const onDemandMiniArtwork = document.getElementById('miniPlayerArt');
const playbackProgressBar = document.getElementById('progressBar');
const playbackProgressFill = document.getElementById('progressFill');
const playbackProgressThumb = document.getElementById('progressThumb');
const onDemandPrevButton = document.getElementById('onDemandPrevButton');
const onDemandNextButton = document.getElementById('onDemandNextButton');

let youtubeApiPromise = null;
let youtubePlayerPromise = null;
let youtubePlayer = null;
let youtubePlayerReady = false;
let requestedVideoId = '';
let requestedStartSeconds = 0;
let selectedDuration = 0;
let songRequestId = 0;
let videoCandidates = [];
let videoCandidateIndex = 0;
let onDemandArtworkRequestId = 0;
const albumArtworkCache = new Map();

/* Every on-demand song played this session, in order. The previous/next
   buttons walk this list; the live feed is not part of it. */
let onDemandQueue = [];
let onDemandQueueIndex = -1;
let isScrubbing = false;
let scrubTargetSeconds = 0;
let scrubbingBar = null;

/* YouTube Music's generated next queue, fetched as soon as a track starts so
   the next eligible Topic audio track is ready when playback ends. */
let relatedTrackCache = [];
let relatedTrackCursor = 0;
let isFetchingRelated = false;
let prefetchToken = 0;
let autoplayRetryTimer = 0;

/* VideoIds already played this session, so a radio playlist that circles back
   to an earlier track does not replay it. */
const playedVideoIds = new Set();

function updateNowPlayingSubtitle(isOnDemand) {
  if (nowPlayingSubtitle) {
    nowPlayingSubtitle.textContent = isOnDemand
      ? 'Discover music through Autoplay'
      : 'Discover music through Live';
  }
}

/* On-demand state survives refreshes and closed tabs. The saved track and
   queue are restored paused; only "Back to Live" clears the saved session. */
const ON_DEMAND_STORAGE_KEY = 'thaalam-on-demand-session-v1';
const YOUTUBE_SEARCH_CACHE_PREFIX = 'thaalam-youtube-search-v16:';
const YOUTUBE_SEARCH_CACHE_TTL = 6 * 60 * 60 * 1000;
const NON_YOUTUBE_MUSIC_TITLE = /\b(?:official\s+)?music\s+video\b|\b(?:official\s+)?video\b|\bvisuali[sz]er\b|\blyrics?\b|\blive\b|\bkaraoke\b|\bcover\b|\bperformance\b|\breaction\b/i;
const UNOFFICIAL_MIX_TITLE = /\b(?:unofficial|remix(?:es)?|mix(?:es)?|mash[ -]?up|medley|compilation|playlist|slowed(?:\s+\+?\s+reverb)?|sped\s*up|nightcore|bootleg|fan[ -]?made|edit|1\s*hour|extended|instrumental|8d(?:\s+audio)?|bass\s+boosted|reverb)\b/i;

/* TEMPORARY DIAGNOSTIC: set to false to silence. Reports what is written, what
   is read back, and which branch the restore actually takes. */
const ON_DEMAND_DEBUG = true;
const logOnDemand = (...parts) => {
  if (ON_DEMAND_DEBUG) console.log('[on-demand]', ...parts);
};

function getYouTubeSearchCache(query) {
  try {
    const cached = JSON.parse(localStorage.getItem(
      `${YOUTUBE_SEARCH_CACHE_PREFIX}${query}`
    ) || 'null');
    if (cached?.expiresAt > Date.now() && Array.isArray(cached.items)) {
      return cached.items;
    }
  } catch {
  }
  return null;
}

function setYouTubeSearchCache(query, items) {
  try {
    localStorage.setItem(`${YOUTUBE_SEARCH_CACHE_PREFIX}${query}`, JSON.stringify({
      expiresAt: Date.now() + YOUTUBE_SEARCH_CACHE_TTL,
      items
    }));
  } catch {
  }
}

async function searchYouTubeVideos(query, maxResults = 10) {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ');
  if (!normalizedQuery) return [];
  const cacheKey = `${normalizedQuery.toLowerCase()}|${maxResults}`;
  const cached = getYouTubeSearchCache(cacheKey);
  if (cached) return cached;

  const url = new URL('/api/youtube-search', window.location.origin);
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, maxResults))));
  const response = await fetch(url, { cache: 'no-store' });
  const responseText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    if (/^\s*</.test(responseText)) {
      throw new Error('');
    }
    throw new Error(`Returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) {
    const apiError = typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message;
    throw new Error(apiError || `Playback failed (${response.status}).`);
  }

  const items = payload.results || [];

  setYouTubeSearchCache(cacheKey, items);
  return items;
}

async function fetchYouTubeAutoplayQueue(videoId, playlistId = '') {
  const url = new URL('/api/youtube-autoplay', window.location.origin);
  url.searchParams.set('videoId', videoId);
  if (playlistId) url.searchParams.set('playlistId', playlistId);
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Autoplay failed (${response.status}).`);
  return {
    playlistId: payload?.playlistId || playlistId,
    tracks: Array.isArray(payload?.results) ? payload.results : []
  };
}

function normalizeYouTubeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeYouTubeSongTitle(value) {
  return normalizeYouTubeText(String(value || '')
    .replace(/\s*\((?:with|feat(?:uring)?|ft\.?)\s+[^)]*\)/gi, '')
    .replace(/\s+(?:with|feat(?:uring)?|ft\.?)\s+.+$/i, '')
    .replace(/\s*\[(?:official\s+)?audio\]/gi, ''));
}

function lookupAlbumArtwork(title, artist) {
  const query = `${title || ''} ${artist || ''}`.trim();
  if (!query) return Promise.resolve('');
  const key = query.toLowerCase();
  if (albumArtworkCache.has(key)) return albumArtworkCache.get(key);
  const promise = new Promise((resolve) => {
    const callbackName = `thaalamArtwork${Date.now()}${Math.random().toString(36).slice(2)}`;
    const request = document.createElement('script');
    const timeout = window.setTimeout(() => finish(''), 10000);
    let settled = false;
    function finish(url) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      delete window[callbackName];
      request.remove();
      resolve(url || '');
    }
    window[callbackName] = (data) => {
      const result = (data?.results || []).find((item) => item.artworkUrl100);
      finish(result?.artworkUrl100?.replace(/^http:/, 'https:').replace(/\d+x\d+bb\./, '600x600bb.') || '');
    };
    request.onerror = () => finish('');
    const params = new URLSearchParams({ term: query, entity: 'song', media: 'music', limit: '8', callback: callbackName });
    request.src = `https://itunes.apple.com/search?${params}`;
    document.head.appendChild(request);
  });
  albumArtworkCache.set(key, promise);
  return promise;
}
window.lookupAlbumArtwork = lookupAlbumArtwork;

async function findYouTubeSong(song) {
  const title = song.trackName || '';
  const artist = song.artistName || '';
  const album = song.collectionName || '';
  const normalizedTitle = normalizeYouTubeSongTitle(title);
  const sourceArtists = artist.split(/,|&|\bfeat(?:uring)?\b|\bwith\b/i)
    .map(normalizeYouTubeText).filter(Boolean);
  const normalizedAlbum = normalizeYouTubeText(album);

  const rankResults = (items, albumFirst) => items
    .map((item, index) => {
      const candidateTitle = normalizeYouTubeSongTitle(item.title);
      const candidateArtist = normalizeYouTubeText(item.artist);
      const candidateAlbum = normalizeYouTubeText(item.album);
      const exactTitle = candidateTitle === normalizedTitle;
      const titleMatch = exactTitle ||
        (normalizedTitle.length > 3 && candidateTitle.includes(normalizedTitle)) ||
        (candidateTitle.length > 3 && normalizedTitle.includes(candidateTitle));
      const artistMatch = sourceArtists.some((name) => candidateArtist.includes(name));
      const featuredArtistMatch = sourceArtists.some((name) =>
        name !== normalizeYouTubeText(artist) && candidateTitle.includes(name));
      const albumMatch = Boolean(normalizedAlbum && candidateAlbum &&
        (candidateAlbum.includes(normalizedAlbum) || normalizedAlbum.includes(candidateAlbum)));
      const rejectedTitle = NON_YOUTUBE_MUSIC_TITLE.test(item.title) ||
        UNOFFICIAL_MIX_TITLE.test(item.title);
      const officialAudio = /\b(?:official\s+)?(?:original\s+)?audio\b/i.test(item.title);
      return {
        ...item,
        score: (exactTitle ? 100 : titleMatch ? 65 : 0) +
          (artistMatch ? 30 : 0) + (featuredArtistMatch ? 8 : 0) +
          (albumFirst && albumMatch ? 24 : albumMatch ? 12 : 0) +
          (officialAudio ? 15 : 0) + Math.max(0, 20 - index) -
          (rejectedTitle ? 1000 : 0)
      };
    }).filter((item) => item.videoId && item.topicAudio === true &&
      !NON_YOUTUBE_MUSIC_TITLE.test(item.title) &&
      !UNOFFICIAL_MIX_TITLE.test(item.title))
      .sort((a, b) => b.score - a.score);

  // Search the named album first, then retry with exact-title variants. Keep
  // the best Songs-filtered result across all queries instead of failing just
  // because YouTube formats a title or featured-artist credit differently.
  const queries = [
    album && { query: `${title} ${artist} ${album}`, albumFirst: true },
    { query: `${title} ${artist}`, albumFirst: false },
    { query: `${normalizeYouTubeSongTitle(title)} ${artist}`, albumFirst: false }
  ].filter((entry) => String(entry?.query || '').trim());
  const candidates = new Map();
  for (const { query, albumFirst } of queries) {
    const items = await searchYouTubeVideos(query, 25);
    rankResults(items, albumFirst).forEach((item) => {
      const current = candidates.get(item.videoId);
      if (!current || item.score > current.score) candidates.set(item.videoId, item);
    });
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) throw new Error('Song Not playable');
  return { ...best, alternatives: ranked.slice(1).map((item) => item.videoId) };
}

function saveOnDemandSession(song, videoId, position = 0) {
  try {
    const payload = JSON.stringify({
      song,
      videoId,
      position: Math.max(0, Number(position) || 0),
      queue: onDemandQueue,
      queueIndex: onDemandQueueIndex,
      // Paused state is part of the session: reopening should not start making
      // noise on its own if the listener had deliberately stopped the song.
      playing: window.onDemandPlaying === true
    });
    localStorage.setItem(ON_DEMAND_STORAGE_KEY, payload);
    logOnDemand('saved', {
      trackName: song?.trackName,
      videoId,
      playing: window.onDemandPlaying === true,
      bytes: payload.length
    });
  } catch (error) {
    // Storage can be blocked or full; on-demand still works for this visit.
    console.error('[on-demand] save failed:', error);
  }
}

function readOnDemandSession() {
  let raw = null;
  try {
    raw = localStorage.getItem(ON_DEMAND_STORAGE_KEY);
    logOnDemand('raw storage read', raw === null ? '(absent)' : 'present');
    const stored = JSON.parse(raw || 'null');
    if (!stored) {
      logOnDemand('no usable session (absent or unparseable)');
      return null;
    }
    if (!stored?.song?.trackName || !stored?.videoId) {
      logOnDemand('session present but incomplete', {
        hasSong: Boolean(stored?.song),
        hasTrackName: Boolean(stored?.song?.trackName),
        hasVideoId: Boolean(stored?.videoId),
        keys: Object.keys(stored)
      });
      return null;
    }
    logOnDemand('session restored from storage', stored.song.trackName, stored.videoId);
    return stored;
  } catch (error) {
    console.error('[on-demand] read failed:', error);
    return null;
  }
}

function clearOnDemandSession() {
  try {
    localStorage.removeItem(ON_DEMAND_STORAGE_KEY);
  } catch {
  }
}

/* The song and videoId currently loaded in the iframe. Kept as module state so
   pause/play changes can rewrite the stored session without re-running a search. */
let currentOnDemandSong = null;
let currentOnDemandVideoId = '';
let currentOnDemandPosition = 0;

function setCurrentOnDemandTrack(song, videoId, position = 0) {
  currentOnDemandSong = song;
  currentOnDemandVideoId = videoId || '';
  currentOnDemandPosition = Math.max(0, Number(position) || 0);
}

function persistCurrentOnDemandSession() {
  if (!currentOnDemandSong?.trackName || !currentOnDemandVideoId) return;
  if (youtubePlayerReady && window.onDemandPlaybackActive) {
    currentOnDemandPosition = youtubePlayer.getCurrentTime() || currentOnDemandPosition;
  }
  saveOnDemandSession(currentOnDemandSong, currentOnDemandVideoId, currentOnDemandPosition);
}

function formatOnDemandTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function parseVideoDuration(duration) {
  if (!duration) return 0;
  return duration.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;

    // The API script can vanish without ever firing onerror: blocked by an
    // extension, throttled, or swallowed by a captive portal. With no deadline
    // the promise simply never settles, so the restore await below waited
    // forever and left the player stuck on "Resuming on demand" instead of
    // falling back. Fail fast and let the caller recover.
    const timeoutId = window.setTimeout(() => {
      youtubeApiPromise = null;
      script.remove();
      reject(new Error('player timed out loading.'));
    }, 12000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    script.onerror = () => {
      window.clearTimeout(timeoutId);
      youtubeApiPromise = null;
      reject(new Error('Player failed to load.'));
    };

    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

function setPlaybackProgress(elapsed, duration) {
  if (!playbackProgressBar || !playbackProgressFill) return;

  const safeDuration = Number(duration) || 0;
  const safeElapsed = Math.max(0, Number(elapsed) || 0);
  const percent = safeDuration > 0
    ? Math.min(100, (safeElapsed / safeDuration) * 100)
    : 0;

  playbackProgressFill.style.width = `${percent}%`;
  if (playbackProgressThumb) playbackProgressThumb.style.left = `${percent}%`;
  playbackProgressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
}

function updatePlaybackProgress() {
  if (window.onDemandPlaybackActive) {
    let elapsed = 0;
    let duration = selectedDuration;
    if (youtubePlayerReady) {
      elapsed = youtubePlayer.getCurrentTime() || 0;
      duration = youtubePlayer.getDuration() || duration;
    }

    // While dragging, report the pointer's target instead of the player's
    // position so the readout matches what the user is holding.
    if (isScrubbing) {
      elapsed = scrubTargetSeconds;
      if (!duration) duration = selectedDuration;
    }

    onDemandElapsed.textContent = formatOnDemandTime(elapsed);
    onDemandDuration.textContent = formatOnDemandTime(duration);
    setPlaybackProgress(elapsed, duration);
    return;
  }

  // Live radio: show progress for the song currently on air.
  const liveClock = window.getAudibleTrackClock?.();
  if (liveClock && Number(liveClock.duration) > 0) {
    setPlaybackProgress(liveClock.elapsed, liveClock.duration);
  } else {
    setPlaybackProgress(0, 0);
  }
}

/* Resolves the seconds a pointer x-position maps to, clamped to the track. */
function getScrubSecondsFromPointer(clientX, bar) {
  if (!bar || !youtubePlayerReady) return null;

  const rect = bar.getBoundingClientRect();
  if (!rect.width) return null;

  const duration = youtubePlayer.getDuration() || selectedDuration;
  if (!(duration > 0)) return null;

  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * duration;
}

/* Repaints the full-player bar and the mini bar from the scrub target so
   neither keeps ticking to the real position while the pointer is held. */
function repaintScrub() {
  updatePlaybackProgress();
  window.updateMiniPlayerTime?.();
}

/* On-demand only: live radio is not seekable, so pointerdown is ignored there. */
function beginScrub(event, bar) {
  if (!window.onDemandPlaybackActive || !youtubePlayerReady) return;

  const seconds = getScrubSecondsFromPointer(event.clientX, bar);
  if (seconds === null) return;

  isScrubbing = true;
  scrubTargetSeconds = seconds;
  scrubbingBar = bar;
  bar.classList.add('is-scrubbing');
  bar.setPointerCapture?.(event.pointerId);
  repaintScrub();
}

function moveScrub(event) {
  if (!isScrubbing || !scrubbingBar) return;

  const seconds = getScrubSecondsFromPointer(event.clientX, scrubbingBar);
  if (seconds === null) return;

  scrubTargetSeconds = seconds;
  repaintScrub();
}

/* Shared reset when a track change or mode switch interrupts a drag. */
function resetScrub() {
  isScrubbing = false;
  scrubTargetSeconds = 0;
  scrubbingBar?.classList.remove('is-scrubbing');
  playbackProgressBar?.classList.remove('is-scrubbing');
  scrubbingBar = null;
}

/* The mini clock reads this so its readout follows the drag too. */
window.getDemandScrubSeconds = () => (isScrubbing ? scrubTargetSeconds : NaN);

function commitScrub() {
  if (!isScrubbing || !youtubePlayerReady) return;
  isScrubbing = false;
  scrubbingBar?.classList.remove('is-scrubbing');
  scrubbingBar = null;

  // Nudge a few milliseconds past the target: the YouTube API can ignore a
  // seek to the exact position it is already reporting.
  const target = Math.min(
    (youtubePlayer.getDuration() || selectedDuration || 0),
    Math.max(0, scrubTargetSeconds + 0.05)
  );
  if (target > 0 || scrubTargetSeconds <= 0) {
    youtubePlayer.seekTo(target, true);
  }
}

function bindScrubBar(bar) {
  if (!bar) return;
  bar.addEventListener('pointerdown', (event) => beginScrub(event, bar));
  bar.addEventListener('pointermove', moveScrub);
  bar.addEventListener('pointerup', commitScrub);
  bar.addEventListener('pointercancel', commitScrub);
}

bindScrubBar(playbackProgressBar);
bindScrubBar(document.getElementById('miniPlayerProgress'));

function setOnDemandPlaying(isPlaying) {
  // Mirror of the live flag, so a restored session can reapply the pause state
  // the listener had chosen instead of always resuming with sound.
  window.onDemandPlaying = isPlaying;
  // Keep the stored session in step with the transport, otherwise a reload
  // would replay a song the listener had already paused.
  if (window.onDemandPlaybackActive) persistCurrentOnDemandSession();
  window.setPlayerVisualState?.(isPlaying);
  if (navigator.mediaSession) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
  onDemandPlayButton?.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  onDemandMiniToggle?.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  if (isPlaying) window.showPlayerPauseIcon?.();
  else window.showPlayerPlayIcon?.();
  onDemandPlayButton?.classList.remove('is-loading');
  onDemandMiniToggle?.classList.remove('is-loading');
}

function handleYouTubeState(event) {
  logOnDemand('player state ->', event.data,
    '(active =', window.onDemandPlaybackActive, ')');
  if (!window.onDemandPlaybackActive) return;

  const states = window.YT.PlayerState;
  if (event.data === states.PLAYING) {
    onDemandModeLabel.textContent = 'ON DEMAND';
    // Re-pin the level in case this video came up at the player's default.
    syncYouTubeVolumeToStored();
    setOnDemandPlaying(true);
  } else if (event.data === states.BUFFERING) {
    onDemandModeLabel.textContent = 'BUFFERING';
    onDemandPlayButton?.classList.add('is-loading');
    onDemandMiniToggle?.classList.add('is-loading');
  } else if (event.data === states.ENDED) {
    onDemandModeLabel.textContent = 'ON DEMAND';
    setOnDemandPlaying(false);
    // Autoplay continues into a similar song; the label is updated by
    // advanceToSimilarSong() while the related list is being fetched.
    advanceToSimilarSong();
  } else if (
    event.data === states.PAUSED ||
    event.data === states.CUED
  ) {
    onDemandModeLabel.textContent = 'ON DEMAND';
    setOnDemandPlaying(false);
  }
}

/* Re-assert the listener's stored volume level + mute flag on the YouTube
   player. The level is only pushed once in onReady today, so a later
   loadVideoById (track change, autoplay advance, error fallback) can come up
   at the player's own default (loud) while the slider visibly stays put.
   Calling this right after every load and again on PLAYING keeps the audible
   level pinned to what the slider shows. True loudness differences between
   uploads (mastering) can't be normalized from here: the iframe is
   cross-origin, so WebAudio metering/gain is unavailable. */
function syncYouTubeVolumeToStored() {
  if (!youtubePlayerReady || !youtubePlayer) return;
  try {
    const storedLevel = typeof window.getStoredVolumeLevel === 'function'
      ? window.getStoredVolumeLevel()
      : NaN;
    if (Number.isFinite(storedLevel)) {
      youtubePlayer.setVolume(Math.max(0, Math.min(100, Math.round(storedLevel))));
    }
    let muted = false;
    try {
      muted = localStorage.getItem('thaalam-muted-v1') === '1';
    } catch (_) { /* storage unavailable; leave mute state alone */ }
    if (muted) youtubePlayer.mute();
    else if (typeof youtubePlayer.unMute === 'function') youtubePlayer.unMute();
  } catch (_) { /* player not controllable yet */ }
}

function handleYouTubeError(event) {
  logOnDemand('player ERROR code =', event?.data,
    '(active =', window.onDemandPlaybackActive,
    ', candidates =', videoCandidates.length, ')');
  if (!window.onDemandPlaybackActive) return;
  if (videoCandidateIndex + 1 < videoCandidates.length) {
    videoCandidateIndex += 1;
    onDemandModeLabel.textContent = 'TRYING ANOTHER RESULT';
    event.target.loadVideoById(videoCandidates[videoCandidateIndex]);
    syncYouTubeVolumeToStored();
    return;
  }
  console.error('Rejected every matching video:', event.data);
  onDemandMount.hidden = true;
  onDemandArtwork.hidden = false;
  onDemandArtwork.style.opacity = '1';
  onDemandPlayButton.disabled = true;
  onDemandMiniToggle.disabled = true;
  onDemandModeLabel.textContent = 'UNAVAILABLE';
  onDemandStation.textContent = 'Playback unavailable';
  setOnDemandPlaying(false);
  returnToLiveButton.hidden = false;
}

async function loadVideo(videoId, requestId, startSeconds = 0, shouldPlay = true) {
  requestedVideoId = videoId;
  requestedStartSeconds = Math.max(0, Number(startSeconds) || 0);
  await loadYouTubeApi();
  if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
  onDemandMount.hidden = false;
  // Keep the album artwork visible on top of the YouTube iframe so the
  // embedded video player stays masked while its audio keeps playing.
  onDemandArtwork.hidden = false;
  onDemandArtwork.style.opacity = '1';

  if (youtubePlayerReady) {
    const loadMethod = shouldPlay ? 'loadVideoById' : 'cueVideoById';
    youtubePlayer[loadMethod]({ videoId, startSeconds: requestedStartSeconds });
    syncYouTubeVolumeToStored();
    return;
  }

  if (!youtubePlayerPromise) {
    youtubePlayerPromise = new Promise((resolve, reject) => {
      const initialVideoId = requestedVideoId;
      try {
        youtubePlayer = new window.YT.Player('onDemandPlayerFrame', {
          width: '100%',
          height: '100%',
          videoId: initialVideoId,
          playerVars: {
            autoplay: shouldPlay ? 1 : 0,
            controls: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
            start: Math.floor(requestedStartSeconds)
          },
          events: {
            onReady(event) {
              youtubePlayerReady = true;
              // Honor the persisted volume/mute choices before any audio starts.
              // The bridge in script.js guards the missing-key case (Number(null)
              // === 0) and falls back to the shared default level.
              try {
                const storedLevel = typeof window.getStoredVolumeLevel === 'function'
                  ? window.getStoredVolumeLevel()
                  : NaN;
                if (Number.isFinite(storedLevel)) {
                  event.target.setVolume(storedLevel);
                }
                if (localStorage.getItem('thaalam-muted-v1') === '1') event.target.mute();
              } catch (_) { /* storage unavailable; default to audible */ }
              if (!window.onDemandPlaybackActive) {
                event.target.pauseVideo();
                resolve(event.target);
                return;
              }
              if (requestedVideoId !== initialVideoId) {
                event.target.loadVideoById({
                  videoId: requestedVideoId,
                  startSeconds: requestedStartSeconds
                });
                syncYouTubeVolumeToStored();
              } else if (shouldPlay) {
                event.target.playVideo();
              } else {
                event.target.cueVideoById({
                  videoId: requestedVideoId,
                  startSeconds: requestedStartSeconds
                });
              }
              resolve(event.target);
            },
            onStateChange: handleYouTubeState,
            onError: handleYouTubeError
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  await youtubePlayerPromise;
}

function updateOnDemandMetadata(song, video) {
  video = video || {};
  const title = song?.trackName || video.title || 'Unknown song';
  const artist = String(song?.artistName || video.artist || 'Unknown artist')
    .replace(/\s-\sTopic$/i, '')
    .trim();
  const album = song?.collectionName || '';
  const catalogArtwork = song?.artworkUrl100
    ?.replace(/^http:/, 'https:')
    .replace(/\d+x\d+bb\./, '600x600bb.') || '';
  const youtubeArtwork = String(video.thumbnail || '').replace(/^http:/, 'https:');
  const artwork = catalogArtwork || youtubeArtwork;
  const nowPlaying = {
    title,
    artist,
    album,
    art: artwork,
    id: video.videoId
  };
  const data = {
    now_playing: {
      song: nowPlaying,
      elapsed: 0,
      duration: selectedDuration
    }
  };

  window.currentNowPlayingSong = nowPlaying;
  window.latestNowPlayingData = data;
  document.title = `${title} - ${artist} | Thaalam 24x7`;
  onDemandStation.textContent = 'On-Demand';
  onDemandModeLabel.textContent = 'LOADING';
  onDemandTrack.dataset.trackTitle = title;
  onDemandTrack.dataset.trackArtist = artist;
  onDemandTrack.textContent = `${title} – ${artist}`;
  onDemandMiniTitle.textContent = title;
  onDemandMiniArtist.textContent = artist;
  // Invalidate any live-radio image load as soon as on-demand metadata changes.
  // Preload before swapping so a failed/slow thumbnail cannot leave the prior
  // track's artwork visible (a common case when the YouTube thumbnail is stale).
  const colorRequestId = window.bumpArtworkRequestId?.() ?? 0;
  const artworkRequestId = ++onDemandArtworkRequestId;
  onDemandArtwork.src = 'album-placeholder.svg?v=2';
  onDemandArtwork.classList.remove('is-youtube-thumbnail');
  onDemandMiniArtwork.src = 'album-placeholder.svg?v=2';
  onDemandMiniArtwork.classList.remove('is-youtube-thumbnail');

  // Prefer iTunes album art; use the Topic upload artwork if iTunes has none.
  const videoIdArtwork = video.videoId
    ? `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`
    : '';
  const candidates = [...new Set([catalogArtwork, youtubeArtwork, videoIdArtwork]
    .filter(Boolean)
    .map((url) => String(url).replace(/^http:/, 'https:')))];
  const tryArtwork = (index) => {
    if (artworkRequestId !== onDemandArtworkRequestId) return;
    if (index >= candidates.length) {
      if (song._didArtworkLookup) return;
      song._didArtworkLookup = true;
      Promise.resolve(window.lookupAlbumArtwork?.(title, artist) || '')
        .then((url) => {
          if (!url || artworkRequestId !== onDemandArtworkRequestId) return;
          candidates.push(url);
          tryArtwork(index);
        })
        .catch(() => {});
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (artworkRequestId !== onDemandArtworkRequestId) return;
      onDemandArtwork.src = candidates[index];
      onDemandArtwork.classList.toggle(
        'is-youtube-thumbnail',
        image.naturalWidth / image.naturalHeight > 1.1
      );
      onDemandMiniArtwork.src = candidates[index];
      onDemandMiniArtwork.classList.toggle(
        'is-youtube-thumbnail',
        image.naturalWidth / image.naturalHeight > 1.1
      );
      window.updateAlbumColors?.(candidates[index], colorRequestId);
      if (candidates[index] !== artwork) {
        song.artworkUrl100 = candidates[index];
        if (currentOnDemandSong === song) persistCurrentOnDemandSession();
        if (navigator.mediaSession && 'MediaMetadata' in window) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title, artist, album,
            artwork: [{ src: candidates[index], sizes: '512x512' }]
          });
        }
      }
    };
    image.onerror = () => tryArtwork(index + 1);
    image.src = candidates[index];
  };
  tryArtwork(0);
  window.updateMarquee?.();
  window.updateMiniPlayerMarquees?.();
  window.dispatchEvent(new CustomEvent('thaalam:nowplaying', { detail: data }));

  if (navigator.mediaSession && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: artwork ? [{ src: artwork, sizes: '512x512' }] : []
    });
  }
}

/* Appends a song to the session queue unless it is already the current entry
   (re-selecting the same track should not create a duplicate step). */
function enqueueOnDemandSong(song) {
  const current = onDemandQueue[onDemandQueueIndex];
  const isSameAsCurrent =
    current &&
    current.trackName === song.trackName &&
    (current.artistName || '') === (song.artistName || '');

  if (isSameAsCurrent) return;

  // Playing a new song after going back truncates the forward history, the way
  // a browser's back/forward stack behaves.
  onDemandQueue = onDemandQueue.slice(0, onDemandQueueIndex + 1);
  onDemandQueue.push(song);
  onDemandQueueIndex = onDemandQueue.length - 1;
}

function updateTransportButtonState() {
  if (onDemandPrevButton) {
    onDemandPrevButton.disabled = onDemandQueueIndex <= 0;
  }
  if (onDemandNextButton) {
    // Next stays enabled while unplayed related tracks remain, so the listener
    // can move on before the current song ends.
    const hasQueuedNext = onDemandQueueIndex >= 0 && onDemandQueueIndex < onDemandQueue.length - 1;
    const hasRelatedNext = relatedTrackCursor < relatedTrackCache.length;
    onDemandNextButton.disabled = onDemandQueueIndex < 0 || (!hasQueuedNext && !hasRelatedNext);
  }
}

function skipOnDemandSong(offset) {
  // At the end of the played queue, move into the related list we already
  // fetched rather than trying to walk past the last entry.
  if (offset > 0 && onDemandQueueIndex >= onDemandQueue.length - 1) {
    const nextRelated = relatedTrackCache[relatedTrackCursor];
    if (!nextRelated) return;

    relatedTrackCursor += 1;
    playRelatedTrack(nextRelated);
    return;
  }

  const nextIndex = onDemandQueueIndex + offset;
  const nextSong = onDemandQueue[nextIndex];
  if (!nextSong) return;

  onDemandQueueIndex = nextIndex;
  updateTransportButtonState();
  // Skips stay in the listener's current view; only fresh picks open Now
  // Playing (see startOnDemandSong).
  startOnDemandSong(nextSong, { preserveQueue: true, openNowPlaying: false });
}

onDemandPrevButton?.addEventListener('click', () => skipOnDemandSong(-1));
onDemandNextButton?.addEventListener('click', () => skipOnDemandSong(1));

/* Fetches YouTube Music's own next queue, retaining only Topic-style audio. */
async function fetchRelatedTracks(videoId, song) {
  if (!videoId && !song?.artistName) return [];
  try {
    // The first request starts a YouTube Music radio mix; later requests keep
    // using the returned mix playlist so recommendations can span artists.
    const queue = await fetchYouTubeAutoplayQueue(videoId, song?.youtubePlaylistId || '');
    const tracks = queue.tracks;
    return tracks
      .filter((track) => track.topicAudio === true &&
        !playedVideoIds.has(track.videoId) &&
        !NON_YOUTUBE_MUSIC_TITLE.test(track.title) &&
        !UNOFFICIAL_MIX_TITLE.test(track.title))
      .map((track) => ({
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        thumbnail: track.thumbnail,
        topicAudio: track.topicAudio,
        primaryGenreName: song?.primaryGenreName || '',
        duration: track.duration || '',
        playlistId: queue.playlistId || song?.youtubePlaylistId || ''
      }));
  } catch (error) {
    console.warn('Autoplay: Failed.', error);
    return [];
  }
}

/* Kicks off a background queue lookup as soon as the current track starts. */
function prefetchRelatedTracks(videoId, song) {
  if (!videoId && !song?.artistName) return;

  const token = ++prefetchToken;
  isFetchingRelated = true;

  fetchRelatedTracks(videoId, song)
    .then((tracks) => {
      // Ignore a response for a track the listener has already moved past.
      if (token !== prefetchToken) return;
      relatedTrackCache = tracks.filter((track) => !playedVideoIds.has(track.videoId));
      relatedTrackCursor = 0;
      prefetchUpcomingTrackArtwork();
      updateTransportButtonState();
    })
    .finally(() => {
      if (token === prefetchToken) isFetchingRelated = false;
    });
}

/* Normalises a related track into the song shape the rest of the module uses
   (startOnDemandSong and updateOnDemandMetadata both expect trackName/
   artistName/artworkUrl100, matching the iTunes catalog shape). */
function relatedTrackToSong(track) {
  return {
    trackName: track.title || 'Unknown song',
    artistName: (track.artist || '').replace(/\s-\sTopic$/i, '').trim(),
    collectionName: '',
    primaryGenreName: track.primaryGenreName || '',
    artworkUrl100: track.artworkUrl100 || '',
    trackTimeMillis: (parseVideoDuration(track.duration) || 0) * 1000,
    youtubeVideoId: track.videoId,
    youtubePlaylistId: track.playlistId || ''
  };
}

function prefetchTrackArtwork(track) {
  if (track.artworkUrl100 || track.artworkPromise) {
    return track.artworkPromise || Promise.resolve(track.artworkUrl100);
  }

  track.artworkPromise = Promise.resolve(
    window.lookupAlbumArtwork?.(track.title, track.artist) || ''
  ).then((artworkUrl) => {
    if (!artworkUrl) return '';
    track.artworkUrl100 = artworkUrl;
    const image = new Image();
    image.src = artworkUrl;
    return artworkUrl;
  }).catch(() => '');

  return track.artworkPromise;
}

function prefetchUpcomingTrackArtwork() {
  relatedTrackCache
    .slice(relatedTrackCursor, relatedTrackCursor + 4)
    .forEach((track) => { void prefetchTrackArtwork(track); });
}

/* Called when a track ends. Plays the next prefetched YouTube Music queue item. */
function advanceToSimilarSong() {
  if (!window.onDemandPlaybackActive) return;

  const nextTrack = relatedTrackCache[relatedTrackCursor];
  if (nextTrack) {
    relatedTrackCursor += 1;
    playRelatedTrack(nextTrack);
    return;
  }

  // The prefetch has not landed yet (or returned no eligible audio). Retry briefly rather
  // than leaving the listener at a silent dead end, then say so on screen.
  let attempts = 0;
  window.clearInterval(autoplayRetryTimer);
  autoplayRetryTimer = window.setInterval(() => {
    if (!window.onDemandPlaybackActive) {
      window.clearInterval(autoplayRetryTimer);
      return;
    }

    const retryTrack = relatedTrackCache[relatedTrackCursor];
    if (retryTrack) {
      window.clearInterval(autoplayRetryTimer);
      relatedTrackCursor += 1;
      playRelatedTrack(retryTrack);
      return;
    }

    attempts += 1;
    if (attempts > 100 || (!isFetchingRelated && attempts > 12)) {
      window.clearInterval(autoplayRetryTimer);
      onDemandModeLabel.textContent = 'ON DEMAND';
      // Surface the reason in the station slot: the mode label is hidden while
      // on-demand is active, so without this the player just stops silently.
      onDemandStation.textContent = 'No more similar songs';
    }
  }, 250);
}

/* Starts a track that came from the related list. It already has a resolved
   videoId, so it skips the search round-trip that startOnDemandSong performs. */
async function playRelatedTrack(track) {
  const artworkPromise = prefetchTrackArtwork(track);
  const song = relatedTrackToSong(track);
  const requestId = ++songRequestId;

  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  onDemandQueue.push(song);
  onDemandQueueIndex = onDemandQueue.length - 1;
  updateTransportButtonState();

  resetScrub();

  // A related track may be a poor match for the iframe, so keep the same
  // candidate fallback the search path uses.
  videoCandidates = [track.videoId];
  videoCandidateIndex = 0;

  // Record the track before it loads, so a refresh mid-load still restores.
  song.youtubePlaylistId = track.playlistId || '';
  setCurrentOnDemandTrack(song, track.videoId);
  persistCurrentOnDemandSession();

  updateOnDemandMetadata(song, { videoId: track.videoId });
  void artworkPromise.then((artworkUrl) => {
    if (!artworkUrl || currentOnDemandVideoId !== track.videoId) return;
    song.artworkUrl100 = artworkUrl;
    setCurrentOnDemandTrack(song, track.videoId);
    persistCurrentOnDemandSession();
    updateOnDemandMetadata(song, { videoId: track.videoId });
  });
  prefetchUpcomingTrackArtwork();
  await loadVideo(track.videoId, requestId);
  if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
  updatePlaybackProgress();
  // Chain: fetch the generated next queue for this track immediately.
  playedVideoIds.add(track.videoId);
  prefetchRelatedTracks(track.videoId, song);
}

async function startOnDemandSong(song, { preserveQueue = false, openNowPlaying = true } = {}) {
  if (!song?.trackName) return;
  // Ratings-backed favourites may contain partial or older metadata. Keep the
  // player input shape consistent before artwork lookup, search, and queueing.
  song = {
    ...song,
    trackName: String(song.trackName || '').trim(),
    artistName: String(song.artistName || '').trim(),
    collectionName: String(song.collectionName || '').trim(),
    artworkUrl100: String(song.artworkUrl100 || '')
  };
  if (!song.trackName) return;
  if (!preserveQueue) {
    const current = onDemandQueue[onDemandQueueIndex];
    const isSameAsCurrent = current
      && current.trackName === song.trackName
      && (current.artistName || '') === (song.artistName || '');
    if (!isSameAsCurrent) {
      // A listener's new selection starts a fresh history. Autoplay tracks
      // added afterward can still be played next and navigated back to.
      onDemandQueue = [];
      onDemandQueueIndex = -1;
      relatedTrackCache = [];
      relatedTrackCursor = 0;
      isFetchingRelated = false;
      prefetchToken += 1;
    }
  }
  const artworkPromise = song.artworkUrl100
    ? Promise.resolve(song.artworkUrl100)
    : lookupAlbumArtwork(song.trackName, song.artistName);
  void artworkPromise.then((artworkUrl) => {
    if (!artworkUrl) return;
    song.artworkUrl100 = artworkUrl;
    if (currentOnDemandSong === song) {
      persistCurrentOnDemandSession();
      updateOnDemandMetadata(song, { videoId: currentOnDemandVideoId });
    }
  });
  const requestId = ++songRequestId;
  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  enqueueOnDemandSong(song);
  updateTransportButtonState();
  resetScrub();
  window.onDemandPlaybackActive = true;
  updateNowPlayingSubtitle(true);
  window.setOnDemandAudioQuality?.(true);
  document.body.classList.add('on-demand-active');
  window.pauseLiveStreamForOnDemand?.();
  returnToLiveButton.hidden = false;
  onDemandModeLabel.textContent = 'Hang on';
  onDemandStation.textContent = 'On-Demand';
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;
  onDemandPlayButton?.classList.add('is-loading');
  onDemandMiniToggle?.classList.add('is-loading');

  try {
    // openNowPlaying defaults to true for the artwork-search path. Catalog
    // picks and prev/next skips pass false: they play through the mini player,
    // whose art/title already open Now Playing, and yanking the listener out
    // of Home/About on every pick or skip is unwanted.
    if (openNowPlaying) {
      await window.showView?.('now-playing');
    }
    if (requestId !== songRequestId) return;

    // History entries created by autoplay already have a resolved video ID.
    // Reuse it when navigating back so we don't run a fresh title search (which
    // can fail or select a different upload).
    const video = song.youtubeVideoId
      ? { videoId: song.youtubeVideoId, duration: '' }
      : await findYouTubeSong(song);
    if (requestId !== songRequestId) return;

    videoCandidates = [...new Set([video.videoId, ...(video.alternatives || [])])];
    videoCandidateIndex = 0;
    selectedDuration = parseVideoDuration(video.duration) || selectedDuration;
    // Begin a radio mix for this selected track, not the source album playlist.
    song.youtubePlaylistId = song.youtubeVideoId ? (song.youtubePlaylistId || '') : '';
    song.youtubeVideoId = video.videoId;
    setCurrentOnDemandTrack(song, video.videoId);
    persistCurrentOnDemandSession();
    updateOnDemandMetadata(song, video);
    await loadVideo(video.videoId, requestId);
    if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
    updatePlaybackProgress();
    playedVideoIds.add(video.videoId);
    prefetchRelatedTracks(video.videoId, song);
  } catch (error) {
    if (requestId !== songRequestId) return;
    console.error('Unable to start on-demand playback:', error);
    onDemandModeLabel.textContent = 'UNAVAILABLE';
    const message = error instanceof TypeError && error.message === 'Failed to fetch'
      ? 'Song not playable. Check your connection'
      : error.message || 'Playback unavailable';
    onDemandStation.textContent = message;
    setOnDemandPlaying(false);
    returnToLiveButton.hidden = false;
  }
}

function toggleOnDemandPlayback(shouldPlay) {
  if (!youtubePlayerReady) return;
  const isPlaying = youtubePlayer.getPlayerState() === window.YT.PlayerState.PLAYING;
  if (shouldPlay === false || (shouldPlay !== true && isPlaying)) {
    youtubePlayer.pauseVideo();
  } else {
    youtubePlayer.playVideo();
  }
}

/* Restores the saved on-demand track and navigation queue after a refresh or
   reopen, but waits for an explicit Play action before producing audio. */
async function restoreOnDemandSession() {
  logOnDemand('restoreOnDemandSession() called');
  const stored = readOnDemandSession();
  if (!stored) {
    logOnDemand('ABORT: nothing to restore');
    return;
  }

  if (window.matchMedia('(max-width: 56.1875rem), (pointer: coarse)').matches) {
    logOnDemand('discarding restored on-demand session on mobile');
    clearOnDemandSession();
    window.togglePlay?.();
    return;
  }

  const song = stored.song;
  // Keep the session's navigation history across refreshes. Older saved
  // sessions contain only the current song, so they still restore as a
  // one-entry queue.
  const savedQueue = Array.isArray(stored.queue)
    ? stored.queue.filter((entry) => entry?.trackName && entry?.youtubeVideoId)
    : [];
  const savedIndex = Number.isInteger(stored.queueIndex) ? stored.queueIndex : -1;
  if (savedQueue.length && savedIndex >= 0 && savedIndex < savedQueue.length) {
    onDemandQueue = savedQueue;
    onDemandQueueIndex = savedIndex;
    // The session song/video are authoritative for the currently loaded item.
    onDemandQueue[onDemandQueueIndex] = { ...song, youtubeVideoId: stored.videoId };
  } else {
    onDemandQueue = [];
    onDemandQueueIndex = -1;
    enqueueOnDemandSong({ ...song, youtubeVideoId: stored.videoId });
  }
  // Enter the same on-demand state a fresh selection would, before any live
  // data arrives, so the radio cannot paint over the restored song.
  window.onDemandPlaybackActive = true;
  updateNowPlayingSubtitle(true);
  window.setOnDemandAudioQuality?.(true);
  document.body.classList.add('on-demand-active');
  window.pauseLiveStreamForOnDemand?.();
  returnToLiveButton.hidden = false;
  onDemandModeLabel.textContent = 'LOADING';
  onDemandStation.textContent = 'Ready to resume';
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;

  const requestId = ++songRequestId;
  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  updateTransportButtonState();
  setCurrentOnDemandTrack(song, stored.videoId, stored.position || 0);

  try {
    // Deliberately no showView() call here. The listener's view (Home, About or
    // Now Playing) has already been restored by restoreActiveView(), and forcing
    // this module back to Now Playing would yank them out of the page they were
    // on. On-demand surfaces in the mini player, which is visible from every
    // view, so restoring the track itself is enough.
    if (requestId !== songRequestId) return;

    // A resolved videoId is stored, so load it without searching for it again.
    videoCandidates = [stored.videoId];
    videoCandidateIndex = 0;
    updateOnDemandMetadata(song, { videoId: stored.videoId });
    await loadVideo(stored.videoId, requestId, stored.position || 0, false);
    logOnDemand('loadVideo() resolved; playerReady =', youtubePlayerReady,
      'state =', youtubePlayerReady ? youtubePlayer.getPlayerState() : 'n/a');
    if (requestId !== songRequestId || !window.onDemandPlaybackActive) {
      logOnDemand('ABORT after loadVideo: superseded or no longer on-demand');
      return;
    }

    updatePlaybackProgress();
    playedVideoIds.add(stored.videoId);
    prefetchRelatedTracks(stored.videoId, song);
    // A restored session is always cued. The Play button resumes from the
    // saved position and keeps the restored queue available for navigation.
    setOnDemandPlaying(false);
  } catch (error) {
    console.error('Unable to restore on-demand playback:', error);
    // The YouTube script is third-party, so one blocked or flaky load must not
    // silently drop the listener back to the radio: they would come back to a
    // different station and no sign their track ever existed. Stay in on-demand
    // mode, keep the artwork/title/Back to Live already on screen, and let the
    // transport retry instead. returnToLive() runs only on an explicit press.
    onDemandModeLabel.textContent = 'RETRY';
    onDemandStation.textContent = error.message || 'Playback unavailable';
    onDemandPlayButton?.classList.add('is-loading');
    onDemandMiniToggle?.classList.add('is-loading');
    setPlaybackProgress(0, 0);
  }
}

/* The one and only exit from on-demand. It runs when the listener presses
   "Back to Live" or switches back to the mobile layout. */
function returnToLive() {
  logOnDemand('returnToLive()');
  if (!window.onDemandPlaybackActive) {
    logOnDemand('  -> no-op, on-demand was not active');
    return;
  }
  songRequestId += 1;
  if (youtubePlayerReady) youtubePlayer.pauseVideo();
  resetScrub();
  // Cancel any in-flight related-tracks lookup so a late response cannot
  // restart on-demand playback after the listener has gone back to live.
  window.clearInterval(autoplayRetryTimer);
  prefetchToken += 1;
  relatedTrackCache = [];
  relatedTrackCursor = 0;
  isFetchingRelated = false;
  // The only path off on-demand, so it is also the only place that clears the
  // stored session.
  clearOnDemandSession();
  setCurrentOnDemandTrack(null, '');
  window.onDemandPlaying = false;
  window.onDemandPlaybackActive = false;
  updateNowPlayingSubtitle(false);
  window.setOnDemandAudioQuality?.(false);
  document.body.classList.remove('on-demand-active');
  onDemandMount.hidden = true;
  onDemandArtwork.hidden = false;
  onDemandArtwork.classList.remove('is-youtube-thumbnail');
  onDemandMiniArtwork.classList.remove('is-youtube-thumbnail');
  returnToLiveButton.hidden = true;
  onDemandModeLabel.textContent = 'LIVE';
  onDemandStation.textContent = 'Thaalam 24x7';
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;
  onDemandElapsed.textContent = '0:00';
  onDemandDuration.textContent = '0:00';
  setPlaybackProgress(0, 0);
  setOnDemandPlaying(false);
  // Repaint album art, station/schedule and metadata from the live radio feed.
  window.restoreLiveRadioUi?.();
  window.togglePlay?.();
}

window.startOnDemandSong = startOnDemandSong;
window.toggleOnDemandPlayback = toggleOnDemandPlayback;
window.returnToLive = returnToLive;
window.getCurrentOnDemandSong = () => currentOnDemandSong
  ? { ...currentOnDemandSong, youtubeVideoId: currentOnDemandVideoId || currentOnDemandSong.youtubeVideoId || '' }
  : null;

/* Mute/unmute the on-demand YouTube player. No-op until the player is ready,
   but the persisted state is re-applied in onReady so a reloaded session keeps
   the listener's chosen volume. */
window.setYouTubeMuted = (muted) => {
  if (!youtubePlayerReady || !youtubePlayer) return;
  try {
    if (muted) youtubePlayer.mute();
    else youtubePlayer.unMute();
  } catch (_) { /* player not controllable yet */ }
};

/* Set the on-demand player's volume LEVEL (0-100). No-op until ready. */
window.setYouTubeVolume = (level) => {
  if (!youtubePlayerReady || !youtubePlayer) return;
  try {
    youtubePlayer.setVolume(Math.max(0, Math.min(100, Math.round(Number(level) || 0))));
  } catch (_) { /* player not controllable yet */ }
};

if (onDemandArtwork) {
  onDemandArtwork.setAttribute('role', 'button');
  onDemandArtwork.tabIndex = 0;
  onDemandArtwork.setAttribute('aria-label', 'Find and play this song on YouTube');
  const searchCurrentSong = () => {
    const liveSong = window.currentNowPlayingSong;
    const song = window.onDemandPlaybackActive && currentOnDemandSong
      ? currentOnDemandSong
      : liveSong && {
        trackName: liveSong.title,
        artistName: liveSong.artist,
        collectionName: liveSong.album || liveSong.album_name || '',
        artworkUrl100: liveSong.art
      };
    if (song?.trackName) void startOnDemandSong(song);
  };
  onDemandArtwork.addEventListener('click', searchCurrentSong);
  onDemandArtwork.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    searchCurrentSong();
  });
}
window.getOnDemandTrackClock = () => {
  if (!window.onDemandPlaybackActive) return null;
  return {
    elapsed: youtubePlayerReady ? youtubePlayer.getCurrentTime() || 0 : 0,
    duration: youtubePlayerReady ? youtubePlayer.getDuration() || selectedDuration : selectedDuration
  };
};

returnToLiveButton.addEventListener('click', returnToLive);
let lastPositionSaveAt = 0;
window.setInterval(() => {
  updatePlaybackProgress();
  if (window.onDemandPlaybackActive && Date.now() - lastPositionSaveAt >= 3000) {
    lastPositionSaveAt = Date.now();
    persistCurrentOnDemandSession();
  }
}, 500);
window.addEventListener('pagehide', persistCurrentOnDemandSession);

/* On-demand survives a refresh, so it is restored on load. This runs on
   DOMContentLoaded (rather than inline) so the live-radio startup in script.js
   has finished wiring itself up before on-demand takes over the UI. */
if (document.readyState === 'loading') {
  logOnDemand('readyState=loading, waiting for DOMContentLoaded to restore');
  document.addEventListener('DOMContentLoaded', () => {
    logOnDemand('DOMContentLoaded fired -> restoring');
    void restoreOnDemandSession();
  });
} else {
  void restoreOnDemandSession();
}
