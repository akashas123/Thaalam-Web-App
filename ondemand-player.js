/* On-demand playback for Thaalam: searches JioSaavn through the same-origin
   /api/music-* routes and streams the resolved CDN audio through a plain
   HTML5 <audio> element (no YouTube IFrame involved). */
const onDemandArtwork = document.getElementById('albumArtImg');
const onDemandStation = document.getElementById('stationName');
const onDemandTrack = document.getElementById('nowPlaying');
const onDemandModeLabel = document.querySelector('.live-text');
const returnToLiveButton = document.getElementById('returnToLiveButton');
const liveModeButton = document.getElementById('liveModeButton');
const onDemandModeButton = document.getElementById('onDemandModeButton');
const playerModeToggle = document.querySelector('.player-mode-toggle');
const onDemandPlayButton = document.getElementById('playButton');
const onDemandMiniToggle = document.getElementById('miniPlayerToggle');
const onDemandElapsed = document.getElementById('trackElapsed');
const onDemandDuration = document.getElementById('trackDuration');
const onDemandMiniTitle = document.getElementById('miniPlayerTitle');
const onDemandMiniArtist = document.getElementById('miniPlayerArtist');
const nowPlayingSubtitle = document.getElementById('nowPlayingSubtitle');
const nowPlayingAutoplayContext = document.getElementById('nowPlayingAutoplayContext');
const onDemandMiniArtwork = document.getElementById('miniPlayerArt');
const onDemandMiniProgressBar = document.getElementById('miniPlayerProgress');
const onDemandMiniProgressFill = document.getElementById('miniPlayerProgressFill');
const playbackProgressBar = document.getElementById('progressBar');
const playbackProgressFill = document.getElementById('progressFill');
const playbackProgressThumb = document.getElementById('progressThumb');
const miniPlayerForProgress = document.getElementById('miniPlayer');
const onDemandPrevButton = document.getElementById('onDemandPrevButton');
const onDemandNextButton = document.getElementById('onDemandNextButton');
const onDemandShuffleButton = document.getElementById('onDemandShuffleButton');
const onDemandRepeatButton = document.getElementById('onDemandRepeatButton');
const onDemandRepeatOneBadge = onDemandRepeatButton?.querySelector('.repeat-one-badge');
const onDemandFallbackArtwork = new URL('thaalam-icon-512.png?v=1', window.location.href).href;

/* Two audio elements alternate roles. The standby warms the next track; at a
   transition it becomes the active element so mobile background playback can
   continue from already-buffered media instead of loading a new source on the
   just-ended element. */
let onDemandAudio = new Audio();
onDemandAudio.preload = 'auto';
onDemandAudio.crossOrigin = 'anonymous';
onDemandAudio.setAttribute('playsinline', '');
onDemandAudio.setAttribute('webkit-playsinline', '');
// Warm the next queue stream while the current track is still playing.
// Mobile browsers can delay the ended handler in the background, so avoid
// making the next track's first media request at that boundary.
let autoplayPreloadAudio = new Audio();
autoplayPreloadAudio.preload = 'auto';
autoplayPreloadAudio.crossOrigin = 'anonymous';
let autoplayPreloadedTrackId = '';
let autoplayPreloadedStreamUrl = '';
let handoffOutgoingAudio = null;
let handoffFadeIncomingAudio = null;
let handoffVolume = 1;
let handoffFadeProgress = 1;
// A continuously looping, inaudible stream. Mobile browsers (notably Android
// Chrome) suspend a page's timers/JS when no audio is playing - including when
// the screen locks - which stops on-demand track transitions. Keeping this
// silent track playing keeps the page (and its JS) alive in the background.
const onDemandSilentLoopAudio = new Audio();
try {
  onDemandSilentLoopAudio.src = new URL('silent.wav?v=1', window.location.href).href;
} catch (_) {
  onDemandSilentLoopAudio.src = 'silent.wav?v=1';
}
onDemandSilentLoopAudio.loop = true;
onDemandSilentLoopAudio.preload = 'auto';
onDemandSilentLoopAudio.volume = 1;
onDemandSilentLoopAudio.setAttribute('playsinline', '');
onDemandSilentLoopAudio.setAttribute('webkit-playsinline', '');
// A fixed crossfade avoids downloading and decoding another full copy of each
// song just to inspect its waveform.
const ON_DEMAND_CROSSFADE_MIN_SECONDS = 3;
const ON_DEMAND_CROSSFADE_MAX_SECONDS = 8;

function getAdaptiveCrossfadeSeconds(trackDuration) {
  const duration = Number(trackDuration);
  if (!Number.isFinite(duration) || duration <= 0) return 5;
  return Math.min(
    ON_DEMAND_CROSSFADE_MAX_SECONDS,
    Math.max(ON_DEMAND_CROSSFADE_MIN_SECONDS, duration * 0.04)
  );
}

// Use scheduled Web Audio gain ramps for the crossfade. Unlike a chain of
// setTimeout calls, AudioParam automation is processed by the audio renderer
// and can continue while Android suspends page JavaScript on screen lock.
let onDemandFadeAudioContext = null;
const onDemandGainNodes = new WeakMap();
function getOnDemandFadeAudioContext() {
  if (onDemandFadeAudioContext) return onDemandFadeAudioContext;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    // Music playback favors a larger, lower-power output buffer over the
    // browser's default interactive latency, which can underrun on mobile.
    onDemandFadeAudioContext = new AudioContextCtor({ latencyHint: 'playback' });
  } catch (error) {
    logOnDemand('Web Audio crossfade unavailable:', error?.name || error);
  }
  return onDemandFadeAudioContext;
}
function getOnDemandGainNode(audio) {
  if (!audio) return null;
  const existing = onDemandGainNodes.get(audio);
  if (existing) return existing;
  const context = getOnDemandFadeAudioContext();
  if (!context || context.state !== 'running') return null;
  try {
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    onDemandGainNodes.set(audio, gain);
    return gain;
  } catch (error) {
    logOnDemand('Web Audio gain setup failed:', error?.name || error);
    return null;
  }
}
function resumeOnDemandFadeAudioContext() {
  const context = getOnDemandFadeAudioContext();
  if (!context || context.state === 'running') return;
  context.resume().catch((error) => {
    logOnDemand('Web Audio context resume rejected:', error?.name || error);
  });
}
function setOnDemandGain(audio, value) {
  const gain = getOnDemandGainNode(audio);
  const context = getOnDemandFadeAudioContext();
  if (!gain || !context) return false;
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(value, now);
  return true;
}
function prepareOnDemandFadeAudio() {
  const context = getOnDemandFadeAudioContext();
  if (!context) return Promise.resolve(false);
  return context.resume().then(() => {
    if (context.state !== 'running') return false;
    return Boolean(getOnDemandGainNode(onDemandAudio) &&
      getOnDemandGainNode(autoplayPreloadAudio));
  }).catch((error) => {
    logOnDemand('Web Audio context resume rejected:', error?.name || error);
    return false;
  });
}

function clearAutoplayPreload() {
  autoplayPreloadAudio.pause();
  autoplayPreloadAudio.removeAttribute('src');
  autoplayPreloadAudio.load();
  autoplayPreloadedTrackId = '';
  autoplayPreloadedStreamUrl = '';
}

function promotePreloadedTrack(track) {
  // The resolved stream URL identifies the actual audio. Track ids can differ
  // between a liked-list row and its provider result, so don't reject an
  // otherwise exact buffered source because those ids use different schemes.
  if (!track?.streamUrl || autoplayPreloadedStreamUrl !== track.streamUrl ||
      !autoplayPreloadAudio.getAttribute('src') ||
      autoplayPreloadAudio.error) {
    logOnDemand('next-track preload not ready for handoff', {
      trackId: track?.id || '',
      preloadedTrackId: autoplayPreloadedTrackId,
      readyState: autoplayPreloadAudio.readyState,
      requiredReadyState: 'matching source loaded'
    });
    return false;
  }

  const previousAudio = onDemandAudio;
  onDemandAudio = autoplayPreloadAudio;
  autoplayPreloadAudio = previousAudio;
  // Keep the outgoing stream alive while the incoming source buffers.
  handoffOutgoingAudio = previousAudio;
  handoffFadeIncomingAudio = null;
  handoffVolume = getOnDemandVolumeLevel();
  previousAudio.volume = handoffVolume;
  onDemandAudio.volume = handoffVolume;
  onDemandAudio.muted = previousAudio.muted;
  // Keep Web Audio gains neutral during handoff. The timed element-volume
  // ramp below is the single source of truth for the audible crossfade.
  setOnDemandGain(previousAudio, 1);
  setOnDemandGain(onDemandAudio, 1);
  handoffFadeProgress = 0;
  autoplayPreloadAudio.preload = 'auto';
  autoplayPreloadedTrackId = '';
  autoplayPreloadedStreamUrl = '';
  syncOnDemandVolumeToStored();
  onDemandAudio.volume = 0;
  // Keep the loop running across the source swap and volume handoff.
  startOnDemandSilentLoop();
  void prepareOnDemandFadeAudio();
  logOnDemand('promoted buffered next track', track.id);
  return true;
}

function getOnDemandVolumeLevel() {
  const storedLevel = typeof window.getStoredVolumeLevel === 'function'
    ? Number(window.getStoredVolumeLevel())
    : NaN;
  return Number.isFinite(storedLevel)
    ? Math.max(0, Math.min(100, storedLevel)) / 100
    : 1;
}

function finishOnDemandHandoff() {
  window.clearTimeout(handoffFinishTimer);
  handoffFinishTimer = 0;
  if (handoffOutgoingAudio) {
    handoffOutgoingAudio.pause();
    handoffOutgoingAudio.removeAttribute('src');
    handoffOutgoingAudio.load();
    setOnDemandGain(handoffOutgoingAudio, 1);
  }
  handoffOutgoingAudio = null;
  handoffFadeIncomingAudio = null;
  handoffFadeProgress = 1;
  if (onDemandAudio) onDemandAudio.volume = handoffVolume;
  if (onDemandAudio) setOnDemandGain(onDemandAudio, 1);
  if (window.onDemandPlaying !== true) {
    stopOnDemandSilentLoop();
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  }
}

let handoffFinishTimer = 0;
function finishOnDemandHandoffWhenPlaying() {
  if (!handoffOutgoingAudio || handoffFadeIncomingAudio === onDemandAudio) return;
  const incomingAudio = onDemandAudio;
  const outgoingAudio = handoffOutgoingAudio;
  handoffFadeIncomingAudio = incomingAudio;
  const fadeStartedAt = performance.now();
  const plannedFadeMs = getAdaptiveCrossfadeSeconds(outgoingAudio.duration) * 1000;
  const outgoingDuration = Number(outgoingAudio.duration);
  const outgoingRemainingMs = Number.isFinite(outgoingDuration) && outgoingDuration > 0
    ? Math.max(0, (outgoingDuration - outgoingAudio.currentTime) * 1000)
    : plannedFadeMs;
  const fadeDurationMs = Math.min(plannedFadeMs, outgoingRemainingMs);
  handoffVolume = getOnDemandVolumeLevel();
  window.clearTimeout(handoffFinishTimer);
  if (fadeDurationMs <= 30 || outgoingAudio.ended) {
    handoffFadeProgress = 1;
    incomingAudio.volume = handoffVolume;
    finishOnDemandHandoff();
    if (window.onDemandPlaybackActive) {
      if (onDemandQueueSource === 'favourites') preloadNextLikedQueueTrack();
      else preloadNextAutoplayTrack();
    }
    return;
  }
  handoffFadeProgress = 0;
  incomingAudio.volume = 0;
  outgoingAudio.volume = handoffVolume;
  const fade = () => {
    if (incomingAudio !== onDemandAudio || outgoingAudio !== handoffOutgoingAudio) return;
    const progress = Math.min(1, (performance.now() - fadeStartedAt) / fadeDurationMs);
    handoffFadeProgress = progress;
    incomingAudio.volume = handoffVolume * progress;
    outgoingAudio.volume = handoffVolume * (1 - progress);
    if (progress >= 1) {
      finishOnDemandHandoff();
      if (!window.onDemandPlaybackActive) return;
      if (onDemandQueueSource === 'favourites') preloadNextLikedQueueTrack();
      else preloadNextAutoplayTrack();
      return;
    }
    handoffFinishTimer = window.setTimeout(fade, 30);
  };
  fade();
}

let requestedTrackId = '';
let requestedStreamUrl = '';
let requestedStartSeconds = 0;
/* Seek/play intent recorded by loadTrack() and applied once metadata lands
   (currentTime cannot be set before the duration is known). */
let pendingStartSeconds = -1;
let pendingShouldPlay = false;
let autoplayTrackTransition = false;
let selectedDuration = 0;
let songRequestId = 0;
let liveProgressSongKey = '';
let liveProgressBaseElapsed = 0;
let liveProgressSyncTime = 0;
/* Playable candidates for the current pick ({ id, streamUrl }), so a bad
   stream can fall through to the next search result. */
let trackCandidates = [];
let trackCandidateIndex = 0;
let rerresolvedTrackId = '';
let onDemandArtworkRequestId = 0;
const albumArtworkCache = new Map();

/* Every on-demand song played this session, in order. The previous/next
   buttons walk this list; the live feed is not part of it. */
let onDemandQueue = [];
let onDemandQueueIndex = -1;
let onDemandQueueStartIndex = 0;
function createOnDemandQueueSessionId() {
  return window.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
let onDemandQueueSessionId = createOnDemandQueueSessionId();
let onDemandQueueSource = 'autoplay';
let onDemandShuffle = false;
let shufflePreparedCursor = -1;
let shuffleNormalQueueFuture = null;
let shuffleNormalRelatedFuture = null;
let shuffleSessionPlayedIds = new Set();
let shuffleSessionPlayedKeys = new Set();
let onDemandRepeatMode = 'off';
let onDemandFavouriteQueueLength = 0;
let isScrubbing = false;
let scrubTargetSeconds = 0;
let scrubbingBar = null;
let scrubPointerId = null;

/* Radio recommendations for the playing track, fetched ahead so autoplay
   can continue without waiting for the current song to end. */
let relatedTrackCache = [];
let relatedTrackCursor = 0;
let isFetchingRelated = false;
let prefetchToken = 0;
let autoplayRetryTimer = 0;
let autoplayPrefetchRetryTimer = 0;
let autoplayPrefetchRetryAttempt = 0;
let autoplayPrefetchFailed = false;
let autoplayAnchorTrackId = '';
let mobilePlaybackWasActiveBeforeHide = false;
/* The JioSaavn song-radio station currently driving the continuation queue.
   Each autoplay response builds a fresh station around the playing track, so
   this is informational and keeps the client aligned with the server. */
let radioStationId = '';

/* Track ids already played this session, so an autoplay queue that circles
   back to an earlier track does not replay it. */
const playedTrackIds = new Set();

function updateNowPlayingSubtitle(isOnDemand) {
  if (nowPlayingSubtitle) {
    nowPlayingSubtitle.textContent = isOnDemand
      ? (onDemandQueueSource === 'favourites'
        ? 'Songs you favourited'
        : 'Discover music through Autoplay')
      : 'Discover music through Live';
  }
  if (nowPlayingAutoplayContext) {
    const firstSong = onDemandQueue[0]?.trackName;
    const showPlaybackContext = isOnDemand && Boolean(firstSong);
    nowPlayingAutoplayContext.hidden = !showPlaybackContext;
    nowPlayingAutoplayContext.textContent = showPlaybackContext
      ? onDemandQueueSource === 'favourites'
        ? 'Playing from your library'
        : `Autoplay started from “${firstSong}”`
      : '';
  }
}

/* On-demand state survives refreshes and closed tabs. The selected mode,
   transport state, saved position and queue are restored from local storage.
   v1 held YouTube video ids that this player can no longer play, so the key
   was bumped and stale v1/v2-era payloads are dropped on read. */
const ON_DEMAND_STORAGE_KEY = 'thaalam-on-demand-session-v2';
const ON_DEMAND_RECENTS_KEY = 'thaalam-on-demand-recents-v1';
const ON_DEMAND_PLAYBACK_HISTORY_KEY = 'thaalam-on-demand-playback-history-v1';
const PLAYBACK_MODE_STORAGE_KEY = 'thaalam-playback-mode-v1';
const isMobilePlaybackLayout = () => window.matchMedia('(max-width: 56.1875rem)').matches;
const LEGACY_ON_DEMAND_STORAGE_KEYS = ['thaalam-on-demand-session-v1'];
const MUSIC_SEARCH_CACHE_PREFIX = 'thaalam-jiosaavn-search-v1:';
const MUSIC_SEARCH_CACHE_TTL = 6 * 60 * 60 * 1000;
const NON_CATALOG_TITLE = /\b(?:official\s+)?music\s+video\b|\b(?:official\s+)?video\b|\bvisuali[sz]er\b|\blyrics?\b|\blive\b|\bkaraoke\b|\bcover\b|\bperformance\b|\breaction\b/i;
const UNOFFICIAL_MIX_TITLE = /\b(?:unofficial|remix(?:es)?|mix(?:es)?|mash[ -]?up|medley|compilation|playlist|slowed(?:\s+\+?\s+reverb)?|sped\s*up|nightcore|bootleg|fan[ -]?made|edit|1\s*hour|extended|instrumental|8d(?:\s+audio)?|bass\s+boosted|reverb)\b/i;

/* TEMPORARY DIAGNOSTIC: set to false to silence. Reports what is written, what
   is read back, and which branch the restore actually takes. */
const ON_DEMAND_DEBUG = false;
const logOnDemand = (...parts) => {
  if (ON_DEMAND_DEBUG) console.log('[on-demand]', ...parts);
};

let onDemandRecentHistory = [];
try {
  const storedRecents = JSON.parse(localStorage.getItem(ON_DEMAND_RECENTS_KEY) || '[]');
  if (Array.isArray(storedRecents)) {
    const seenRecentIdentities = new Set();
    onDemandRecentHistory = storedRecents
      .filter((song) => song && typeof song.trackName === 'string' && song.trackName.trim())
      .filter((song) => {
        const identity = song.recentDisplayType === 'liked-folder'
          ? 'liked-folder'
          : `${song.trackName}\n${song.artistName || ''}`.trim().toLocaleLowerCase();
        if (seenRecentIdentities.has(identity)) return false;
        seenRecentIdentities.add(identity);
        return true;
      })
      .slice(0, 10);
    if (onDemandRecentHistory.length !== storedRecents.length) {
      localStorage.setItem(ON_DEMAND_RECENTS_KEY, JSON.stringify(onDemandRecentHistory));
    }
  }
} catch { /* Recent tracks remain available for this visit if storage is blocked. */ }

let onDemandPlaybackHistory = [];
try {
  const storedHistory = JSON.parse(localStorage.getItem(ON_DEMAND_PLAYBACK_HISTORY_KEY) || '[]');
  if (Array.isArray(storedHistory)) {
    onDemandPlaybackHistory = storedHistory
      .filter((song) => song && typeof song.trackName === 'string' && song.trackName.trim())
      .slice(0, 500);
  }
} catch { /* Keep playback history available for this visit if storage is blocked. */ }

let pendingHistoryCommit = 0;
let recentHistoryDirty = false;
let playbackHistoryDirty = false;
function scheduleOnDemandHistoryCommit({ recent = false, playback = false } = {}) {
  recentHistoryDirty ||= recent;
  playbackHistoryDirty ||= playback;
  if (pendingHistoryCommit) return;

  const commit = () => {
    pendingHistoryCommit = 0;
    const saveRecents = recentHistoryDirty;
    const savePlaybackHistory = playbackHistoryDirty;
    recentHistoryDirty = false;
    playbackHistoryDirty = false;
    if (saveRecents) {
      try { localStorage.setItem(ON_DEMAND_RECENTS_KEY, JSON.stringify(onDemandRecentHistory)); }
      catch { /* Keep the in-memory recents list for this visit. */ }
      window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
    }
    if (savePlaybackHistory) {
      try { localStorage.setItem(ON_DEMAND_PLAYBACK_HISTORY_KEY, JSON.stringify(onDemandPlaybackHistory)); }
      catch { /* Keep the in-memory playback history for this visit. */ }
      window.dispatchEvent(new CustomEvent('thaalam-on-demand-playback-history-change'));
    }
    // Include entries added during a commit in a subsequent idle task.
    if (recentHistoryDirty || playbackHistoryDirty) scheduleOnDemandHistoryCommit();
  };

  if ('requestIdleCallback' in window) {
    pendingHistoryCommit = window.requestIdleCallback(commit, { timeout: 1200 });
  } else {
    pendingHistoryCommit = window.setTimeout(commit, 100);
  }
}

function rememberOnDemandPlayback(song) {
  if (!song?.trackName) return;
  const entry = {
    trackName: String(song.trackName),
    artistName: String(song.artistName || ''),
    collectionName: String(song.collectionName || ''),
    artworkUrl100: String(song.artworkUrl100 || ''),
    trackTimeMillis: Number(song.trackTimeMillis) || 0,
    providerTrackId: String(song.providerTrackId || ''),
    queueSource: onDemandQueueSource === 'favourites' ? 'favourites' : 'autoplay',
    queueStartTrackName: String(onDemandQueue[onDemandQueueStartIndex]?.trackName || song.trackName),
    queueSessionId: onDemandQueueSessionId,
    queueStep: Math.max(0, onDemandQueueIndex - onDemandQueueStartIndex),
    playedAt: Date.now()
  };
  onDemandPlaybackHistory = [entry, ...onDemandPlaybackHistory].slice(0, 500);
  scheduleOnDemandHistoryCommit({ playback: true });
}

function rememberOnDemandSong(song, { fromLikedFolder = false } = {}) {
  const recentSong = fromLikedFolder
    ? { ...song, recentDisplayType: 'liked-folder', recentDisplayName: 'Liked Songs', recentDisplayArtist: 'Your library' }
    : { ...song };
  const identity = (entry) => entry.recentDisplayType === 'liked-folder'
    ? 'liked-folder'
    : `${entry.trackName || ''}\n${entry.artistName || ''}`.toLowerCase();
  const key = identity(recentSong);
  onDemandRecentHistory = [
    recentSong,
    ...onDemandRecentHistory.filter((entry) => identity(entry) !== key)
  ].slice(0, 10);
  scheduleOnDemandHistoryCommit({ recent: true });
}

function savePlaybackMode(mode) {
  try {
    localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, mode);
  } catch {
  }
}

function readPlaybackMode() {
  try {
    return localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getMusicSearchCache(query) {
  try {
    const cached = JSON.parse(localStorage.getItem(
      `${MUSIC_SEARCH_CACHE_PREFIX}${query}`
    ) || 'null');
    if (cached?.expiresAt > Date.now() && Array.isArray(cached.items)) {
      return cached.items;
    }
  } catch {
  }
  return null;
}

function setMusicSearchCache(query, items) {
  try {
    localStorage.setItem(`${MUSIC_SEARCH_CACHE_PREFIX}${query}`, JSON.stringify({
      expiresAt: Date.now() + MUSIC_SEARCH_CACHE_TTL,
      items
    }));
  } catch {
  }
}

async function searchSongs(query, maxResults = 10) {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ');
  if (!normalizedQuery) return [];
  const cacheKey = `${normalizedQuery.toLowerCase()}|${maxResults}`;
  const cached = getMusicSearchCache(cacheKey);
  if (cached) return cached;

  const url = new URL('/api/music-search', window.location.origin);
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

  setMusicSearchCache(cacheKey, items);
  return items;
}

/* The continuation queue for a playing track (album remainder + artist top
   songs). JioSaavn has no radio/next-queue endpoint, so the server composes
   it from catalogue sources. */
async function fetchAutoplayQueue(trackId) {
  const url = new URL('/api/music-autoplay', window.location.origin);
  url.searchParams.set('id', trackId);
  url.searchParams.set('k', '50');
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Autoplay failed (${response.status}).`);
  return {
    tracks: Array.isArray(payload?.results) ? payload.results : [],
    stationid: typeof payload?.stationid === 'string' ? payload.stationid : ''
  };
}

/* Fetches one song's fresh metadata (including a freshly decrypted stream
   URL) — used when a stored/cached stream URL stops working. */
async function resolveSong(trackId) {
  if (!trackId) return null;
  const url = new URL('/api/music-song', window.location.origin);
  url.searchParams.set('id', trackId);
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Playback failed (${response.status}).`);
  return Array.isArray(payload?.results) ? payload.results[0] || null : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeSongTitle(value) {
  return normalizeText(String(value || '')
    .replace(/\s*\((?:with|feat(?:uring)?|ft\.?)\s+[^)]*\)/gi, '')
    .replace(/\s+(?:with|feat(?:uring)?|ft\.?)\s+.+$/i, '')
    .replace(/\s*\[(?:official\s+)?audio\]/gi, ''));
}

async function lookupAlbumArtwork(title, artist) {
  const cleanArtist = String(artist || '').replace(/\s-\sTopic$/i, '').trim();
  if (!title || !cleanArtist) return '';
  const query = `${cleanArtist} ${title}`;
  const cacheKey = `lookupAlbumArtwork:${query.toLowerCase()}`;
  const cached = albumArtworkCache.get(cacheKey);
  if (cached) return cached;

  const promise = new Promise(async (resolve) => {
    try {
      const url = new URL('/api/music-search', window.location.origin);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '8');
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) { resolve(''); return; }
      const data = await response.json();
      const result = (data?.results || []).find((item) => item.artworkUrl100);
      resolve(result?.artworkUrl100?.replace(/^http:/, 'https:').replace(/\d+x\d+bb\./, '600x600bb.') || '');
    } catch {
      resolve('');
    }
  });

  albumArtworkCache.set(cacheKey, promise);
  return promise;
}
window.lookupAlbumArtwork = lookupAlbumArtwork;

/* Ranks JioSaavn search results for a concrete song pick. JioSaavn's catalogue
   is official-label audio (no Topic-vs-video distinction like YouTube), so the
   filter drops mixes/karaoke/reaction titles outright while merely demoting
   "live"/"cover"-style words — an exact match should still win when it is the
   only result. */
async function findOnDemandSong(song) {
  const title = song.trackName || '';
  const artist = song.artistName || '';
  const album = song.collectionName || '';
  const normalizedTitle = normalizeSongTitle(title);
  const sourceArtists = artist.split(/,|&|\bfeat(?:uring)?\b|\bwith\b/i)
    .map(normalizeText).filter(Boolean);
  const normalizedAlbum = normalizeText(album);

  const rankResults = (items, albumFirst) => items
    .map((item, index) => {
      const candidateTitle = normalizeSongTitle(item.title);
      const candidateArtist = normalizeText(item.artist);
      const candidateAlbum = normalizeText(item.album);
      const exactTitle = candidateTitle === normalizedTitle;
      const titleMatch = exactTitle ||
        (normalizedTitle.length > 3 && candidateTitle.includes(normalizedTitle)) ||
        (candidateTitle.length > 3 && normalizedTitle.includes(candidateTitle));
      const artistMatch = sourceArtists.some((name) => candidateArtist.includes(name));
      const featuredArtistMatch = sourceArtists.some((name) =>
        name !== normalizeText(artist) && candidateTitle.includes(name));
      const albumMatch = Boolean(normalizedAlbum && candidateAlbum &&
        (candidateAlbum.includes(normalizedAlbum) || normalizedAlbum.includes(candidateAlbum)));
      const rejectedTitle = UNOFFICIAL_MIX_TITLE.test(item.title);
      const nonCatalogTitle = NON_CATALOG_TITLE.test(item.title);
      const officialAudio = /\b(?:official\s+)?(?:original\s+)?audio\b/i.test(item.title);
      return {
        ...item,
        // On favorites restored after a reload, the original provider id may
        // not be available, so title/artist search resolves the stream. Give
        // the credited artist enough weight that an exact-title recording by
        // another artist cannot outrank the intended recording.
        score: (exactTitle ? 100 : titleMatch ? 60 : 0) +
          (artistMatch ? 60 : 0) + (featuredArtistMatch ? 10 : 0) +
          (albumFirst && albumMatch ? 24 : albumMatch ? 12 : 0) +
          (officialAudio ? 15 : 0) + Math.max(0, 20 - index) -
          (rejectedTitle ? 1000 : 0) - (nonCatalogTitle ? 400 : 0)
      };
    }).filter((item) => item.id && item.streamUrl &&
      !UNOFFICIAL_MIX_TITLE.test(item.title))
      .sort((a, b) => b.score - a.score);

  // Search the named album first, then retry with exact-title variants. Keep
  // the best result across all queries instead of failing just because
  // JioSaavn formats a title or featured-artist credit differently.
  const queries = [
    album && { query: `${title} ${artist} ${album}`, albumFirst: true },
    { query: `${title} ${artist}`, albumFirst: false },
    { query: `${normalizeSongTitle(title)} ${artist}`, albumFirst: false }
  ].filter((entry) => String(entry?.query || '').trim());
  const candidates = new Map();
  // Fire every query at once instead of waiting on each in turn. The three
  // searches are independent, so running them together turns ~3 sequential
  // round-trips into one. A single query failing no longer aborts the lookup —
  // the other results are still ranked and used.
  const settled = await Promise.allSettled(
    queries.map(({ query, albumFirst }) =>
      searchSongs(query, 25).then((items) => ({ items, albumFirst }))
    )
  );
  settled.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    rankResults(result.value.items, result.value.albumFirst).forEach((item) => {
      const current = candidates.get(item.id);
      if (!current || item.score > current.score) candidates.set(item.id, item);
    });
  });

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) throw new Error('Song Not playable');
  return {
    ...best,
    alternatives: ranked.slice(1)
      .map((item) => ({ id: item.id, streamUrl: item.streamUrl }))
      .filter((item) => item.streamUrl)
  };
}

// Liked queues can come from local storage or the account API. Resolve their
// playable provider tracks once when the queue is loaded, so Next does not
// have to repeat search/lookup requests for each song.
const likedQueuePreparations = new Map();
let pendingLikedQueueStartKey = '';
let pendingLikedQueueStart = null;
function likedQueuePreparationKey(song) {
  return String(song?.trackKey || song?.providerTrackId ||
    `${song?.trackName || ''}|${song?.artistName || ''}|${song?.collectionName || ''}`)
    .toLowerCase();
}

async function resolveLikedQueueTrack(song) {
  if (song?.providerTrackId && song?.streamUrl) {
    return {
      id: song.providerTrackId,
      streamUrl: song.streamUrl,
      durationSeconds: Number(song.trackTimeMillis) / 1000 || 0,
      thumbnail: song.artworkUrl100,
      title: song.trackName,
      artist: song.artistName,
      album: song.collectionName,
      alternatives: []
    };
  }
  let track = null;
  if (song?.providerTrackId) {
    try { track = await resolveSong(song.providerTrackId); } catch { /* Search by metadata below. */ }
  }
  if (!track?.streamUrl) track = await findOnDemandSong(song);
  if (track?.id && track?.streamUrl) {
    song.providerTrackId = track.id;
    song.streamUrl = track.streamUrl;
    song.providerArtistIds = track.artistIds || song.providerArtistIds || [];
    song.providerAlbumId = track.albumId || song.providerAlbumId || '';
    song.collectionName = song.collectionName || track.album || '';
  }
  return track;
}

function prepareLikedQueue(queue, selectedIndex) {
  const songs = queue.filter((song) => song?.trackName);
  let cursor = 0;
  const worker = async () => {
    while (cursor < songs.length) {
      const song = songs[cursor++];
      const key = likedQueuePreparationKey(song);
      if (!key || (song.providerTrackId && song.streamUrl)) continue;
      const preparation = resolveLikedQueueTrack(song);
      likedQueuePreparations.set(key, preparation);
      try {
        await preparation;
        if (!song.providerTrackId || !song.streamUrl) likedQueuePreparations.delete(key);
      } catch {
        likedQueuePreparations.delete(key);
      }
    }
  };
  // Start from the selected song and limit parallel lookups to avoid flooding
  // the catalogue API when a large liked list is opened.
  songs.sort((a, b) => queue.indexOf(a) - queue.indexOf(b));
  const selectedSong = queue[selectedIndex];
  if (selectedSong) {
    const index = songs.indexOf(selectedSong);
    if (index > 0) songs.unshift(...songs.splice(index, 1));
  }
  void Promise.all(Array.from({ length: Math.min(3, songs.length) }, worker));
}

window.resolveLikedSongIdentity = async (song) => {
  if (!song?.trackName || !song?.artistName) return null;
  const resolved = await findOnDemandSong(song);
  return {
    providerTrackId: resolved.id || '',
    collectionName: resolved.album || song.collectionName || '',
    artworkUrl100: resolved.artworkUrl100 || song.artworkUrl100 || ''
  };
};

function saveOnDemandSession(song, trackId, position = 0) {
  try {
    const payload = JSON.stringify({
      song,
      trackId,
      position: Math.max(0, Number(position) || 0),
      queue: onDemandQueue,
      queueIndex: onDemandQueueIndex,
      queueStartIndex: onDemandQueueStartIndex,
      queueSessionId: onDemandQueueSessionId,
      queueSource: onDemandQueueSource,
      favouriteQueueLength: onDemandFavouriteQueueLength,
       shuffle: onDemandShuffle,
       repeatMode: onDemandRepeatMode,

      autoplayAnchorTrackId
    });
    localStorage.setItem(ON_DEMAND_STORAGE_KEY, payload);
    logOnDemand('saved', {
      trackName: song?.trackName,
      trackId,
      playing: window.onDemandPlaying === true,
      bytes: payload.length
    });
  } catch (error) {
    // Storage can be blocked or full; on-demand still works for this visit.
    console.error('[on-demand] save failed:', error);
  }
}

function readOnDemandSession() {
  // Sessions saved by earlier releases point at YouTube video ids this player
  // cannot play; clear them so they do not linger in storage.
  try {
    LEGACY_ON_DEMAND_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
  }
  let raw = null;
  try {
    raw = localStorage.getItem(ON_DEMAND_STORAGE_KEY);
    logOnDemand('raw storage read', raw === null ? '(absent)' : 'present');
    const stored = JSON.parse(raw || 'null');
    if (!stored) {
      logOnDemand('no usable session (absent or unparseable)');
      return null;
    }
    if (!stored?.song?.trackName || !stored?.trackId) {
      logOnDemand('session present but incomplete', {
        hasSong: Boolean(stored?.song),
        hasTrackName: Boolean(stored?.song?.trackName),
        hasTrackId: Boolean(stored?.trackId),
        keys: Object.keys(stored)
      });
      return null;
    }
    logOnDemand('session restored from storage', stored.song.trackName, stored.trackId);
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

/* The song and track id currently loaded in the audio element. Kept as module
   state so pause/play changes can rewrite the stored session without
   re-running a search. */
let currentOnDemandSong = null;
let currentOnDemandTrackId = '';
let currentOnDemandPosition = 0;

function setCurrentOnDemandTrack(song, trackId, position = 0) {
  currentOnDemandSong = song;
  currentOnDemandTrackId = trackId || '';
  if (onDemandShuffle) {
    if (trackId) shuffleSessionPlayedIds.add(String(trackId));
    const songKey = song?.trackKey || `${song?.trackName || ''}|${song?.artistName || ''}`.toLowerCase();
    if (songKey) shuffleSessionPlayedKeys.add(songKey);
  }
  currentOnDemandPosition = Math.max(0, Number(position) || 0);
  syncDesktopNowPlayingTab();
}

function persistCurrentOnDemandSession() {
  if (!currentOnDemandSong?.trackName || !currentOnDemandTrackId) return;
  if (window.onDemandPlaybackActive && onDemandAudio.getAttribute('src')) {
    currentOnDemandPosition = onDemandAudio.currentTime || currentOnDemandPosition;
  }
  saveOnDemandSession(currentOnDemandSong, currentOnDemandTrackId, currentOnDemandPosition);
}

function formatOnDemandTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function parseDurationString(duration) {
  if (!duration) return 0;
  return duration.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function updatePlaybackProgress() {
  if (window.onDemandPlaybackActive) {
    let elapsed = 0;
    let duration = selectedDuration;
    if (onDemandAudio.getAttribute('src')) {
      elapsed = onDemandAudio.currentTime || 0;
      const mediaDuration = Number(onDemandAudio.duration);
      duration = Number.isFinite(mediaDuration) && mediaDuration > 0
        ? mediaDuration
        : duration;
    }

    const queuedNextSong = onDemandQueueIndex >= 0
      ? onDemandQueue[onDemandQueueIndex + 1]
      : null;
    // When repeat-all reaches the last queued track, the next song wraps to the
    // first queue entry. Treat that as the upcoming track so it can be preloaded
    // and crossfaded into, just like repeat-one does for the current song.
    const repeatAllWrapSong = onDemandRepeatMode === 'all' &&
      onDemandQueue.length > 1 &&
      onDemandQueueIndex >= 0 &&
      onDemandQueueIndex === onDemandQueue.length - 1
      ? onDemandQueue[0]
      : null;
    shuffleUpcomingRelatedTrack();
    const relatedNextTrack = relatedTrackCache[relatedTrackCursor];
    const repeatTrack = onDemandRepeatMode === 'one'
      ? getCurrentOnDemandRepeatTrack()
      : null;
    const shuffledRecommendation = onDemandShuffle && onDemandQueueSource !== 'favourites'
      ? relatedNextTrack
      : null;
    const upcomingTrack = repeatTrack || shuffledRecommendation || queuedNextSong || repeatAllWrapSong || relatedNextTrack;
    // Queue song `id` can be the local liked-song identity, while the preload
    // slot is keyed by its resolved provider id. Prefer that provider id so
    // normal queue entries match the audio that was actually preloaded.
    const upcomingTrackId = upcomingTrack?.providerTrackId || upcomingTrack?.id || '';
    const upcomingTrackStreamUrl = upcomingTrack?.streamUrl || '';
    const hasUpcomingTrack = Boolean(upcomingTrack);
    if (!handoffOutgoingAudio && hasUpcomingTrack &&
        (autoplayPreloadedTrackId !== upcomingTrackId ||
         (upcomingTrackStreamUrl && autoplayPreloadedStreamUrl !== upcomingTrackStreamUrl))) {
      if (repeatTrack?.id && repeatTrack?.streamUrl) {
        preloadTrackAudio(repeatTrack);
      } else if (queuedNextSong?.providerTrackId && queuedNextSong?.streamUrl) {
        preloadTrackAudio({ id: queuedNextSong.providerTrackId, streamUrl: queuedNextSong.streamUrl });
      } else if (repeatAllWrapSong?.providerTrackId && repeatAllWrapSong?.streamUrl) {
        preloadTrackAudio({ id: repeatAllWrapSong.providerTrackId, streamUrl: repeatAllWrapSong.streamUrl });
      } else if (relatedNextTrack?.id && relatedNextTrack?.streamUrl) {
        preloadTrackAudio(relatedNextTrack);
      } else if (repeatAllWrapSong && onDemandQueueSource === 'favourites') {
        preloadRepeatAllWrapTrack();
      } else if (queuedNextSong && onDemandQueueSource === 'favourites') {
        preloadNextLikedQueueTrack();
      }
    }
    const nextTrackIsAvailable = isPreloadedTrackReady(
      upcomingTrackId,
      upcomingTrackStreamUrl
    );
    const handoffLeadSeconds = getAdaptiveCrossfadeSeconds(duration);
    if (!autoplayTrackTransition && hasUpcomingTrack && nextTrackIsAvailable &&
        duration > 0 && elapsed >= duration - handoffLeadSeconds) {
      // Start early enough to buffer and crossfade, keeping the outgoing audio
      // audible until the next track actually starts.
      autoplayTrackTransition = true;
      advanceToSimilarSong();
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
    updateOnDemandMediaSessionPositionState(elapsed, duration);
    return;
  }

  // Live radio: show progress for the song currently on air.
  const liveClock = window.getAudibleTrackClock?.();
  const nowPlaying = window.latestNowPlayingData?.now_playing;
  const song = nowPlaying?.song;
  // The radio API can rotate its internal id between metadata polls. Use the
  // visible track metadata first so those polls don't restart the clock.
  const songKey = [song?.title, song?.artist].filter(Boolean).join('|')
    || song?.id
    || 'live';
  const serverElapsed = Math.max(
    Number(liveClock?.elapsed) || 0,
    Number(nowPlaying?.elapsed) || 0,
    parseDurationString(onDemandElapsed?.textContent || '')
  );
  const now = performance.now();
  if (songKey !== liveProgressSongKey) {
    liveProgressSongKey = songKey;
    liveProgressBaseElapsed = serverElapsed;
    liveProgressSyncTime = now;
  } else if (serverElapsed > liveProgressBaseElapsed + (now - liveProgressSyncTime) / 1000) {
    // Re-sync to the server clock when it moves ahead of our local ticker.
    liveProgressBaseElapsed = serverElapsed;
    liveProgressSyncTime = now;
  }
  const localElapsed = liveProgressBaseElapsed + (
    miniPlayerForProgress?.classList.contains('is-playing')
      ? Math.max(0, now - liveProgressSyncTime) / 1000
      : 0
  );
  const elapsed = Math.max(serverElapsed, localElapsed);
  const duration = Number(liveClock?.duration)
    || Number(nowPlaying?.duration)
    || parseDurationString(onDemandDuration?.textContent || '');
  // Live feeds sometimes omit track length. Keep the same elapsed/duration
  // calculation as the desktop player, with a conservative estimate only
  // while the feed has no duration to report.
  setPlaybackProgress(elapsed, duration || 240);
}

function setPlaybackProgress(elapsed, duration) {
  if (!playbackProgressBar || !playbackProgressFill) return;

  const durationValue = Number(duration);
  const elapsedValue = Number(elapsed);
  const safeDuration = Number.isFinite(durationValue) && durationValue > 0
    ? durationValue
    : 0;
  const safeElapsed = Number.isFinite(elapsedValue)
    ? Math.max(0, elapsedValue)
    : 0;
  const percent = safeDuration > 0
    ? Math.min(100, (safeElapsed / safeDuration) * 100)
    : 0;

  playbackProgressFill.style.width = `${percent}%`;
  // The shared mini-player clock in script.js owns live progress. Keeping
  // this routine as the only mini-fill writer for On-Demand prevents its
  // separate live estimate from fighting the live clock on pause/resume.
  if (onDemandMiniProgressFill && window.onDemandPlaybackActive) {
    const miniPercent = percent > 0 ? Math.max(0.5, Math.min(98, percent)) : 0;
    onDemandMiniProgressFill.style.display = 'block';
    onDemandMiniProgressFill.style.width = `${miniPercent}%`;
  }
  onDemandMiniProgressBar?.classList.remove('is-live');
  if (playbackProgressThumb) playbackProgressThumb.style.left = `${percent}%`;
  playbackProgressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
  onDemandMiniProgressBar?.setAttribute('aria-valuenow', String(Math.round(percent)));
}

/* Resolves the seconds a pointer x-position maps to, clamped to the track. */
function getScrubSecondsFromPointer(clientX, bar) {
  if (!bar || !onDemandAudio.getAttribute('src')) return null;

  const rect = bar.getBoundingClientRect();
  if (!rect.width) return null;

  const duration = onDemandAudio.duration || selectedDuration;
  if (!(duration > 0)) return null;

  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * duration;
}

/* Repaints the full-player bar and the mini bar from the scrub target so
   neither keeps ticking to the real position while the pointer is held. */
function repaintScrub(updateDisc = true) {
  updatePlaybackProgress();
  window.updateMiniPlayerTime?.();
  if (updateDisc) syncAdaptiveDiscPosition(scrubTargetSeconds, 'seeking');
}

/* On-demand only: live radio is not seekable, so pointerdown is ignored there. */
function beginScrub(event, bar) {
  if (!window.onDemandPlaybackActive || !onDemandAudio.getAttribute('src')) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const seconds = getScrubSecondsFromPointer(event.clientX, bar);
  if (seconds === null) return;

  event.preventDefault();
  isScrubbing = true;
  scrubTargetSeconds = seconds;
  scrubbingBar = bar;
  scrubPointerId = event.pointerId;
  bar.classList.add('is-scrubbing');
  try {
    bar.setPointerCapture?.(event.pointerId);
  } catch {
    // Some embedded mobile browsers do not support capture on a progressbar.
  }
  // Freeze the disc at its current angle on press. It follows pointer movement
  // during an actual drag, then the committed seek animates to its destination.
  pauseAdaptiveDiscAtCurrentAngle();
  repaintScrub(false);
}

function moveScrub(event) {
  if (!isScrubbing || !scrubbingBar || event.pointerId !== scrubPointerId) return;

  const seconds = getScrubSecondsFromPointer(event.clientX, scrubbingBar);
  if (seconds === null) return;

  scrubTargetSeconds = seconds;
  repaintScrub();
}

/* Shared reset when a track change or mode switch interrupts a drag. */
function resetScrub() {
  const wasScrubbing = isScrubbing;
  isScrubbing = false;
  scrubTargetSeconds = 0;
  scrubPointerId = null;
  scrubbingBar?.classList.remove('is-scrubbing');
  playbackProgressBar?.classList.remove('is-scrubbing');
  scrubbingBar = null;
  if (wasScrubbing && window.onDemandPlaybackActive) {
    syncAdaptiveDisc(onDemandAudio,
      !onDemandAudio.paused && !onDemandAudio.ended ? 'playing' : 'paused');
  }
}

/* The mini clock reads this so its readout follows the drag too. */
window.getDemandScrubSeconds = () => (isScrubbing ? scrubTargetSeconds : NaN);

function commitScrub(event) {
  if (!isScrubbing || !onDemandAudio.getAttribute('src')) return;
  if (event?.pointerId !== undefined && event.pointerId !== scrubPointerId) return;
  if (event && scrubbingBar) {
    const finalSeconds = getScrubSecondsFromPointer(event.clientX, scrubbingBar);
    if (finalSeconds !== null) scrubTargetSeconds = finalSeconds;
  }
  isScrubbing = false;
  scrubbingBar?.classList.remove('is-scrubbing');
  scrubbingBar = null;
  scrubPointerId = null;

  // Nudge a few milliseconds past the target so the readout is not off by a
  // rounding step once the seek lands.
  const target = Math.min(
    (onDemandAudio.duration || selectedDuration || 0),
    Math.max(0, scrubTargetSeconds + 0.05)
  );
  if (target > 0 || scrubTargetSeconds <= 0) {
    try {
      onDemandAudio.currentTime = target;
      syncAdaptiveDiscPosition(target, 'seeking-settle');
    } catch {
      // Metadata not ready yet; the next progress tick picks the position up.
    }
  }
}

function bindScrubBar(bar) {
  if (!bar) return;
  bar.addEventListener('pointerdown', (event) => beginScrub(event, bar));
  bar.addEventListener('pointermove', moveScrub);
  bar.addEventListener('pointerup', commitScrub);
  bar.addEventListener('pointercancel', resetScrub);
  bar.addEventListener('lostpointercapture', resetScrub);
}

bindScrubBar(playbackProgressBar);
const miniPlayerProgressBar = document.getElementById('miniPlayerProgress');
bindScrubBar(miniPlayerProgressBar);

/* Mobile browsers can route touches near a transparent bar's edge to a
   neighboring layer instead of the bar itself. Recover those touches by
   checking the rendered hit rectangles before the event reaches that layer. */
document.addEventListener('pointerdown', (event) => {
  if (!window.onDemandPlaybackActive || !onDemandAudio.getAttribute('src')) return;

  const bars = [playbackProgressBar, miniPlayerProgressBar].filter(Boolean);
  if (bars.some((bar) => bar.contains(event.target))) return;

  const hitBar = bars.find((bar) => {
    const rect = bar.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (hitBar) beginScrub(event, hitBar);
}, { capture: true });

let onDemandWakeLock = null;
async function acquireOnDemandWakeLock() {
  if (!('wakeLock' in navigator) || onDemandWakeLock) return;
  try {
    onDemandWakeLock = await navigator.wakeLock.request('screen');
    onDemandWakeLock.addEventListener('release', () => { onDemandWakeLock = null; });
  } catch {
    onDemandWakeLock = null;
  }
}
function releaseOnDemandWakeLock() {
  if (!onDemandWakeLock) return;
  try { onDemandWakeLock.release(); } catch { /* ignore */ }
  onDemandWakeLock = null;
}
function startOnDemandSilentLoop() {
  if (!window.onDemandPlaybackActive) return;
  // Repeated play/visibility events should not rewind an already-running loop.
  if (!onDemandSilentLoopAudio.paused && !onDemandSilentLoopAudio.ended) return;
  try { onDemandSilentLoopAudio.currentTime = 0; } catch (_) { /* ignore */ }
  const playPromise = onDemandSilentLoopAudio.play();
  if (playPromise) playPromise.catch(() => { /* autoplay blocked until a gesture */ });
}
function stopOnDemandSilentLoop() {
  try {
    onDemandSilentLoopAudio.pause();
    onDemandSilentLoopAudio.currentTime = 0;
  } catch (_) { /* ignore */ }
}
function setOnDemandPlaying(isPlaying) {
  // Mirror of the live flag, so a restored session can reapply the pause state
  // the listener had chosen instead of always resuming with sound.
  window.onDemandPlaying = isPlaying;
  document.body.classList.toggle('on-demand-paused', !isPlaying);
  // Keep the stored session in step with the transport, otherwise a reload
  // would replay a song the listener had already paused.
  if (window.onDemandPlaybackActive) persistCurrentOnDemandSession();
  window.setPlayerVisualState?.(isPlaying);
  if (navigator.mediaSession) {
    const outgoingStillPlaying = Boolean(handoffOutgoingAudio &&
      !handoffOutgoingAudio.paused && !handoffOutgoingAudio.ended);
    navigator.mediaSession.playbackState = isPlaying || outgoingStillPlaying
      ? 'playing'
      : 'paused';
  }
  // Keep the loop through a source handoff: the outgoing element may still be
  // carrying playback while the incoming element starts. Stop it once the
  // handoff ends if the listener has paused playback.
  if (isPlaying || autoplayTrackTransition || handoffOutgoingAudio) {
    if (window.onDemandPlaybackActive) startOnDemandSilentLoop();
  } else {
    stopOnDemandSilentLoop();
  }
  onDemandPlayButton?.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  onDemandMiniToggle?.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  if (isPlaying) window.showPlayerPauseIcon?.();
  else window.showPlayerPlayIcon?.();
  onDemandPlayButton?.classList.remove('is-loading');
  onDemandMiniToggle?.classList.remove('is-loading');
  window.dispatchEvent(new Event('thaalam:on-demand-playback-state'));
}

function setOnDemandAudioReady(isReady) {
  if (!isReady) {
    adaptiveDiscHasPlayedPastStart = false;
    adaptiveDiscAngle = 0;
    adaptiveDiscClockState = 'paused';
    if (adaptiveDiscRaf) cancelAnimationFrame(adaptiveDiscRaf);
    adaptiveDiscRaf = 0;
    const badge = document.getElementById('streamQuality');
    badge?.style.setProperty('--adaptive-disc-angle', '0deg');
  }
  document.body.classList.toggle(
    'on-demand-audio-ready',
    Boolean(isReady) && Boolean(window.onDemandPlaybackActive)
  );
}

function refreshOnDemandMediaSessionMetadata(song = window.currentNowPlayingSong) {
  if (!window.onDemandPlaybackActive || !navigator.mediaSession ||
      !('MediaMetadata' in window)) return;
  const title = String(song?.title || onDemandTrack.dataset.trackTitle || 'Unknown song').trim();
  const artist = String(song?.artist || onDemandTrack.dataset.trackArtist || 'Unknown artist').trim();
  const album = String(song?.album || 'Thaalam 24x7').trim();
  const artworkSource = String(song?.art || currentOnDemandSong?.artworkUrl100 || '')
    .replace(/^http:/, 'https:');
  let artwork = onDemandFallbackArtwork;
  try {
    if (artworkSource) artwork = new URL(artworkSource, window.location.href).href;
  } catch {
    // Keep the current track's metadata valid even if its artwork URL is bad.
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Unknown song',
      artist: artist || 'Unknown artist',
      album: album || 'Thaalam 24x7',
      artwork: [{ src: artwork, sizes: '512x512' }]
    });
  } catch (error) {
    console.warn('Could not update on-demand media metadata:', error);
  }
}

function updateOnDemandMediaSessionPositionState(elapsed, duration) {
  if (!window.onDemandPlaybackActive || !navigator.mediaSession?.setPositionState) return;
  let position = Number(elapsed);
  let length = Number(duration);
  const hasSource = Boolean(onDemandAudio?.getAttribute?.('src'));
  if (!Number.isFinite(position)) {
    position = hasSource ? (onDemandAudio.currentTime || 0) : 0;
  }
  if (!Number.isFinite(length) || length <= 0) {
    const mediaDuration = Number(onDemandAudio?.duration);
    length = Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : (Number(selectedDuration) || 0);
  }
  if (!Number.isFinite(length) || length <= 0) return;
  const safePosition = Math.min(Math.max(0, position), length);
  const playbackRate = Number(onDemandAudio?.playbackRate) || 1;
  try {
    navigator.mediaSession.setPositionState({
      duration: length,
      playbackRate,
      position: safePosition
    });
  } catch (error) {
    // Some browsers reject incomplete or out-of-range position states.
  }
}

/* Re-assert the listener's stored volume level + mute flag on the audio
   element. Called after every load and again on 'playing' so a track change
   can never come up at a level the slider does not show. */
function syncOnDemandVolumeToStored() {
  if (handoffOutgoingAudio) {
    handoffVolume = getOnDemandVolumeLevel();
    onDemandAudio.volume = handoffVolume * handoffFadeProgress;
    handoffOutgoingAudio.volume = handoffVolume * (1 - handoffFadeProgress);
    return;
  }
  try {
    const storedLevel = typeof window.getStoredVolumeLevel === 'function'
      ? window.getStoredVolumeLevel()
      : NaN;
    if (Number.isFinite(storedLevel)) {
      onDemandAudio.volume = Math.max(0, Math.min(100, Math.round(storedLevel))) / 100;
    }
    try {
      onDemandAudio.muted = localStorage.getItem('thaalam-muted-v1') === '1';
    } catch (_) { /* storage unavailable; leave mute state alone */ }
  } catch (_) { /* storage unavailable; default to audible */ }
}

/* Applies the seek/auto-play intent recorded by loadTrack() once the element
   knows its duration. currentTime cannot be set reliably before then. */
function applyPendingMediaIntent() {
  if (!window.onDemandPlaybackActive) return;
  if (pendingStartSeconds >= 0) {
    const target = pendingStartSeconds;
    pendingStartSeconds = -1;
    try {
      // A fresh pick passes 0: seeking explicitly restarts the same song from
      // the top instead of continuing where it was (the old `target > 0`
      // guard skipped the seek, so re-tapping a playing card did nothing).
      onDemandAudio.currentTime = target;
    } catch {
      logOnDemand('seek to', target, 'rejected; starting from the top');
    }
  }
  if (pendingShouldPlay) {
    pendingShouldPlay = false;
    const playPromise = onDemandAudio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        // Autoplay policy or a transient rejection: stay visibly paused so the
        // listener can press Play (their gesture always succeeds).
        logOnDemand('play() rejected:', error?.name || error);
        if (window.onDemandPlaybackActive) {
          autoplayTrackTransition = false;
          setOnDemandPlaying(false);
        }
      });
    }
  }
}

let adaptiveDiscRaf = 0;
let adaptiveDiscClockBase = 0;
let adaptiveDiscClockAt = 0;
let adaptiveDiscClockState = 'paused';
let adaptiveDiscAngle = 0;
let adaptiveDiscLastFrameAt = 0;
let adaptiveDiscHasPlayedPastStart = false;

function renderAdaptiveDiscFrame(now) {
  adaptiveDiscRaf = 0;
  const badge = document.getElementById('streamQuality');
  if (!badge || !window.onDemandPlaybackActive) return;

  let targetAngle;
  if (adaptiveDiscClockState === 'playing') {
    if (!adaptiveDiscHasPlayedPastStart && onDemandAudio.currentTime >= 0.05 &&
        !onDemandAudio.paused && !onDemandAudio.ended) {
      adaptiveDiscHasPlayedPastStart = true;
    }
    if (!adaptiveDiscHasPlayedPastStart) {
      adaptiveDiscLastFrameAt = now;
      adaptiveDiscRaf = requestAnimationFrame(renderAdaptiveDiscFrame);
      return;
    }
    const playbackRate = Number(onDemandAudio.playbackRate) || 1;
    const seconds = adaptiveDiscClockBase + Math.max(0, now - adaptiveDiscClockAt) / 1000 * playbackRate;
    targetAngle = Math.max(0, seconds - 0.05) * 150;
    adaptiveDiscAngle = targetAngle;
  } else if (adaptiveDiscClockState === 'seeking' || adaptiveDiscClockState === 'seeking-settle') {
    if (!adaptiveDiscHasPlayedPastStart) {
      adaptiveDiscRaf = 0;
      if (adaptiveDiscClockState === 'seeking-settle') adaptiveDiscClockState = 'paused';
      return;
    }
    const seconds = isScrubbing ? scrubTargetSeconds : (Number(onDemandAudio.currentTime) || 0);
    targetAngle = Math.max(0, seconds - 0.05) * 150;
    const delta = targetAngle - adaptiveDiscAngle;
    const frameSeconds = Math.min(0.05, Math.max(0, now - (adaptiveDiscLastFrameAt || now)) / 1000);
    const maxStep = 1800 * frameSeconds;
    adaptiveDiscAngle = adaptiveDiscClockState === 'seeking' && isScrubbing
      ? targetAngle
      : (Math.abs(delta) <= maxStep ? targetAngle
        : adaptiveDiscAngle + Math.sign(delta) * maxStep);

    if (adaptiveDiscClockState === 'seeking-settle' && !isScrubbing && !onDemandAudio.seeking &&
        adaptiveDiscAngle === targetAngle) {
      adaptiveDiscClockState = 'paused';
      const settledBadge = document.getElementById('streamQuality');
      settledBadge?.classList.remove('is-disc-seeking');
      adaptiveDiscLastFrameAt = now;
      settledBadge?.style.setProperty('--adaptive-disc-angle', `${adaptiveDiscAngle}deg`);
      return;
    }
  } else {
    return;
  }

  adaptiveDiscLastFrameAt = now;
  badge.style.setProperty('--adaptive-disc-angle', `${adaptiveDiscAngle}deg`);
  adaptiveDiscRaf = requestAnimationFrame(renderAdaptiveDiscFrame);
}

function syncAdaptiveDiscPosition(seconds, state = 'playing') {
  const badge = document.getElementById('streamQuality');
  if (!badge) return;
  const position = Number(seconds) || 0;
  adaptiveDiscClockBase = position;
  adaptiveDiscClockAt = performance.now();
  adaptiveDiscClockState = state;
  if (state === 'paused') {
    if (adaptiveDiscRaf) cancelAnimationFrame(adaptiveDiscRaf);
    adaptiveDiscRaf = 0;
    adaptiveDiscAngle = Math.max(0, position - 0.05) * 150;
    adaptiveDiscLastFrameAt = 0;
    badge.style.setProperty('--adaptive-disc-angle', `${adaptiveDiscAngle}deg`);
  } else if (!adaptiveDiscRaf) {
    adaptiveDiscLastFrameAt = 0;
    adaptiveDiscRaf = requestAnimationFrame(renderAdaptiveDiscFrame);
  }
  badge.classList.toggle('is-disc-paused', state !== 'playing');
  badge.classList.toggle('is-disc-seeking', state === 'seeking' || state === 'seeking-settle');
}

function syncAdaptiveDisc(audio, state = 'playing') {
  if (audio !== onDemandAudio) return;
  syncAdaptiveDiscPosition(isScrubbing ? scrubTargetSeconds : audio.currentTime, state);
}

function pauseAdaptiveDiscAtCurrentAngle() {
  const badge = document.getElementById('streamQuality');
  if (!badge) return;
  adaptiveDiscClockState = 'paused';
  if (adaptiveDiscRaf) cancelAnimationFrame(adaptiveDiscRaf);
  adaptiveDiscRaf = 0;
  badge.classList.toggle('is-disc-paused', !isScrubbing);
  badge.classList.toggle('is-disc-seeking', isScrubbing);
}

function bindOnDemandAudioEvents(audio) {
  audio.addEventListener('timeupdate', () => {
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
    if (!audio.paused && !audio.ended && audio.currentTime >= 0.05) {
      adaptiveDiscHasPlayedPastStart = true;
    }
    syncAdaptiveDisc(audio, isScrubbing || audio.seeking
      ? 'seeking'
      : (!audio.paused && !audio.ended ? 'playing' : 'paused'));
    updatePlaybackProgress();
  });
  audio.addEventListener('loadedmetadata', () => {
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
    syncAdaptiveDisc(audio, 'paused');
    setOnDemandAudioReady(true);
    applyPendingMediaIntent();
  });
  audio.addEventListener('seeking', () => {
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
    syncAdaptiveDisc(audio, 'seeking');
  });
  audio.addEventListener('seeked', () => {
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
    // Keep the seek transition active through the final seeked position so
    // reverse scrubbing visibly follows the playhead even while audio is paused.
    syncAdaptiveDisc(audio, !audio.paused && !audio.ended ? 'playing' : 'seeking-settle');
  });
  audio.addEventListener('playing', () => {
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
    if (audio.currentTime >= 0.05) adaptiveDiscHasPlayedPastStart = true;
    syncAdaptiveDisc(audio, 'playing');
    setOnDemandAudioReady(true);
    autoplayTrackTransition = false;
    resumeOnDemandFadeAudioContext();
    logOnDemand('playing', audio.currentTime.toFixed(1), 's');
    refreshOnDemandMediaSessionMetadata();
    updateOnDemandMediaSessionPositionState();
    onDemandModeLabel.textContent = 'ON DEMAND';
    if (navigator.mediaSession) {
      try { navigator.mediaSession.playbackState = 'playing'; } catch { /* ignore */ }
    }
    if (handoffOutgoingAudio && audio === onDemandAudio) {
      finishOnDemandHandoffWhenPlaying();
    } else {
      syncOnDemandVolumeToStored();
      // Start buffering the next liked track as soon as this one begins. If we
      // wait for recommendation fetching or the last few seconds, the normal
      // queue transitions can reach the handoff without buffered audio.
      if (onDemandQueueSource === 'favourites') preloadNextLikedQueueTrack();
    }
    setOnDemandPlaying(true);
    void acquireOnDemandWakeLock();
    if (window.onDemandPlaybackActive) startOnDemandSilentLoop();

  });
  audio.addEventListener('pause', () => {
  // Fires for track swaps, src teardown and listener-initiated pauses alike.
  // By the time a queued pause event lands, returnToLive() has usually already
  // cleared the active flag — this guard keeps teardown from repainting state.
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive ||
        audio.ended || autoplayTrackTransition) return;
    // Preserve the displayed angle: a scrub preview can be ahead of the media
    // element until its seek finishes, so pausing must not snap it backward.
    pauseAdaptiveDiscAtCurrentAngle();
    onDemandModeLabel.textContent = 'ON DEMAND';
    if (navigator.mediaSession) {
      try { navigator.mediaSession.playbackState = 'paused'; } catch { /* ignore */ }
    }
    setOnDemandPlaying(false);
    releaseOnDemandWakeLock();
  });
  for (const eventName of ['waiting', 'stalled']) {
    audio.addEventListener(eventName, () => {
      if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
      onDemandModeLabel.textContent = 'BUFFERING';
      onDemandPlayButton?.classList.add('is-loading');
      onDemandMiniToggle?.classList.add('is-loading');
    });
  }
  audio.addEventListener('ended', () => {
    if (audio !== onDemandAudio || !window.onDemandPlaybackActive) return;
    syncAdaptiveDisc(audio, 'paused');
    if (autoplayTrackTransition) return;
    if (onDemandRepeatMode === 'all' && onDemandQueueSource === 'favourites' &&
        onDemandQueue.length > 1) {
      const isAtQueueEnd = onDemandQueueIndex === onDemandQueue.length - 1;
      const nextSong = isAtQueueEnd
        ? onDemandQueue[0]
        : onDemandQueue[onDemandQueueIndex + 1];
      if (nextSong) {
        // This event means the timed fade window was missed. Don't advance
        // here: keep this queue index active and replay the current track so
        // the progress timer can hand off while both tracks are still live.
        if (isAtQueueEnd) preloadRepeatAllWrapTrack();
        else preloadNextLikedQueueTrack();
        autoplayTrackTransition = false;
        try { audio.currentTime = 0; } catch { /* ended audio may reject the seek */ }
        audio.play().catch(() => {});
        return;
      }
    }
    autoplayTrackTransition = true;
    onDemandModeLabel.textContent = 'ON DEMAND';
    advanceToSimilarSong();
  });
  audio.addEventListener('error', () => {
    if (audio !== onDemandAudio) return;
    logOnDemand('media ERROR', audio.error?.code,
      '(active =', window.onDemandPlaybackActive,
      ', candidates =', trackCandidates.length, ')');
    handlePlaybackError();
  });
}

bindOnDemandAudioEvents(onDemandAudio);
bindOnDemandAudioEvents(autoplayPreloadAudio);

// Some mobile browsers suspend a PWA's media when the screen is off, and may
// restore it through pageshow instead of a visibilitychange event. Resume only
// if playback was active before the app was hidden; a user pause or a fresh
// app launch must remain paused.
function resumeMobilePlaybackAfterBackground() {
  if (!isMobilePlaybackLayout()) return;
  if (document.hidden) {
    mobilePlaybackWasActiveBeforeHide ||=
      Boolean(window.onDemandPlaybackActive && window.onDemandPlaying);
    return;
  }
  if (autoplayPrefetchFailed && !isFetchingRelated && currentOnDemandTrackId) {
    window.clearTimeout(autoplayPrefetchRetryTimer);
    autoplayPrefetchRetryTimer = 0;
    prefetchRelatedTracks(currentOnDemandTrackId, true);
  }
  if (!mobilePlaybackWasActiveBeforeHide) return;
  mobilePlaybackWasActiveBeforeHide = false;
  if (!window.onDemandPlaybackActive) return;
  void prepareOnDemandFadeAudio();

  const duration = Number(onDemandAudio.duration);
  const reachedTrackEnd = onDemandAudio.ended ||
    (Number.isFinite(duration) && duration > 0 &&
      onDemandAudio.currentTime >= duration - 0.35);
  if (reachedTrackEnd) {
    autoplayTrackTransition = true;
    advanceToSimilarSong();
  } else if (onDemandAudio.paused) {
    const playPromise = onDemandAudio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        logOnDemand('background resume rejected:', error?.name || error);
      });
    }
  }
  if (window.onDemandPlaybackActive && window.onDemandPlaying) void acquireOnDemandWakeLock();
  if (window.onDemandPlaybackActive) startOnDemandSilentLoop();

}

document.addEventListener('visibilitychange', resumeMobilePlaybackAfterBackground);
window.addEventListener('pageshow', resumeMobilePlaybackAfterBackground);
document.addEventListener('resume', resumeMobilePlaybackAfterBackground);

/* Called when a stream fails: fall through to the next search result first,
   then ask the server for one fresh stream URL per track (expired CDN links),
   and only then give up with the visible UNAVAILABLE state. */
async function handlePlaybackError() {
  if (!window.onDemandPlaybackActive) return;

  if (trackCandidateIndex + 1 < trackCandidates.length) {
    trackCandidateIndex += 1;
    onDemandModeLabel.textContent = 'TRYING ANOTHER RESULT';
    const candidate = trackCandidates[trackCandidateIndex];
    const resumeSeconds = pendingStartSeconds >= 0 ? pendingStartSeconds : 0;
    const shouldPlay = pendingShouldPlay || window.onDemandPlaying === true;
    await loadTrack(candidate, songRequestId, resumeSeconds, shouldPlay);
    return;
  }

  const trackId = currentOnDemandTrackId;
  if (trackId && rerresolvedTrackId !== trackId) {
    rerresolvedTrackId = trackId;
    onDemandModeLabel.textContent = 'RETRYING STREAM';
    try {
      const fresh = await resolveSong(trackId);
      if (!window.onDemandPlaybackActive || currentOnDemandTrackId !== trackId) return;
      if (fresh?.streamUrl) {
        trackCandidates = [{ id: trackId, streamUrl: fresh.streamUrl }];
        trackCandidateIndex = 0;
        if (currentOnDemandSong) {
          currentOnDemandSong.streamUrl = fresh.streamUrl;
          persistCurrentOnDemandSession();
        }
        await loadTrack(trackCandidates[0], songRequestId, 0, true);
        return;
      }
    } catch (error) {
      logOnDemand('stream re-resolve failed:', error?.message || error);
      if (!window.onDemandPlaybackActive) return;
    }
  }

  console.error('Rejected every stream for this track');
  onDemandArtwork.hidden = false;
  onDemandArtwork.style.opacity = '1';
  onDemandPlayButton.disabled = true;
  onDemandMiniToggle.disabled = true;
  onDemandModeLabel.textContent = 'UNAVAILABLE';
  onDemandStation.textContent = 'Playback unavailable';
  autoplayTrackTransition = false;
  setOnDemandPlaying(false);
  returnToLiveButton.hidden = false;
}

/* Loads one { id, streamUrl } candidate into the audio element. Resolves once
   metadata is known (or shortly after), so callers can update state without
   waiting for the whole song to buffer; media errors are handled separately
   by the 'error' listener above. */
async function loadTrack(candidate, requestId, startSeconds = 0, shouldPlay = true) {
  if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
  requestedTrackId = candidate.id || '';
  requestedStreamUrl = candidate.streamUrl || '';
  const playbackUrl = requestedStreamUrl;
  // Start from the beginning unless this is a saved-position resume.
  let effectiveStartSeconds = Math.max(0, Number(startSeconds) || 0);
  pendingStartSeconds = effectiveStartSeconds;
  pendingShouldPlay = shouldPlay;
  syncOnDemandVolumeToStored();

  const sameSource = requestedStreamUrl
    && onDemandAudio.getAttribute('src') === playbackUrl;
  const alreadyLoaded = sameSource
    && onDemandAudio.readyState >= 1 /* HAVE_METADATA */
    && !onDemandAudio.error;

  if (alreadyLoaded) {
    setOnDemandAudioReady(true);
    applyPendingMediaIntent();
    return;
  }

  if (!requestedStreamUrl) return;

  setOnDemandAudioReady(false);

  const metadataPromise = new Promise((resolve) => {
    let settled = false;
    let deadline = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline);
      onDemandAudio.removeEventListener('loadedmetadata', finish);
      onDemandAudio.removeEventListener('error', finish);
      resolve();
    };
    // The deadline guarantees loadTrack() never hangs a caller indefinitely
    // (the element can already know the file and fire nothing new).
    deadline = window.setTimeout(finish, 12000);
    onDemandAudio.addEventListener('loadedmetadata', finish, { once: true });
    onDemandAudio.addEventListener('error', finish, { once: true });
  });

  if (!sameSource) onDemandAudio.src = playbackUrl;
  onDemandAudio.load();

  // Request playback as soon as the next source is installed. Waiting until
  // loadedmetadata to call play() can leave mobile browsers silent in the
  // background: some defer that event until the screen wakes, even though the
  // queue and Media Session metadata have already advanced. Playback can be
  // requested before metadata; applyPendingMediaIntent() still performs any
  // pending seek when metadata arrives.
  if (shouldPlay) {
    pendingShouldPlay = false;
    const playPromise = onDemandAudio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        if (requestId !== songRequestId || !window.onDemandPlaybackActive ||
            error?.name === 'AbortError') return;
        logOnDemand('play() rejected during track load:', error?.name || error);
        autoplayTrackTransition = false;
        setOnDemandPlaying(false);
      });
    }
  }

  await metadataPromise;
}

function updateOnDemandMetadata(song, track) {
  track = track || {};
  const title = song?.trackName || track.title || 'Unknown song';
  const artist = String(song?.artistName || track.artist || 'Unknown artist')
    .replace(/\s-\sTopic$/i, '')
    .trim();
  // Prefer the resolved provider track's album (the audio actually being
  // played) over a stale catalog album name, keeping song info and the
  // Chrome media session in sync.
  const album = String(track?.album || song?.collectionName || '').trim();
  if (track?.album) song.collectionName = track.album;
  const catalogArtwork = song?.artworkUrl100
    ?.replace(/^http:/, 'https:')
    .replace(/\d+x\d+bb\./, '600x600bb.') || '';
  const providerArtwork = String(track.thumbnail || '').replace(/^http:/, 'https:');
  const artwork = catalogArtwork || providerArtwork;
  const nowPlaying = {
    title,
    artist,
    album,
    art: artwork,
    // Legacy `youtube:ID` liked rows keep their original rating identity while
    // they are on screen; JioSaavn picks fall back to the title|artist key.
    id: song?.youtubeVideoId || ''
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
  // track's artwork visible.
  const colorRequestId = window.bumpArtworkRequestId?.() ?? 0;
  const artworkRequestId = ++onDemandArtworkRequestId;
  onDemandArtwork.src = 'album-placeholder.svg?v=3';
  onDemandArtwork.classList.remove('is-wide-thumbnail');
  onDemandMiniArtwork.src = 'album-placeholder.svg?v=3';
  onDemandMiniArtwork.classList.remove('is-wide-thumbnail');

  // Prefer the pick's own artwork (catalog or JioSaavn); the iTunes lookup is
  // the last resort when neither image loads.
  const candidates = [...new Set([catalogArtwork, providerArtwork]
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
        'is-wide-thumbnail',
        image.naturalWidth / image.naturalHeight > 1.1
      );
      onDemandMiniArtwork.src = candidates[index];
      onDemandMiniArtwork.classList.toggle(
        'is-wide-thumbnail',
        image.naturalWidth / image.naturalHeight > 1.1
      );
      window.updateAlbumColors?.(candidates[index], colorRequestId);
      if (candidates[index] !== artwork) {
        song.artworkUrl100 = candidates[index];
        if (currentOnDemandSong === song) persistCurrentOnDemandSession();
        refreshOnDemandMediaSessionMetadata({ title, artist, album, art: candidates[index] });
      }
    };
    image.onerror = () => tryArtwork(index + 1);
    image.src = candidates[index];
  };
  tryArtwork(0);
  window.updateMarquee?.();
  window.updateMiniPlayerMarquees?.();
  window.dispatchEvent(new CustomEvent('thaalam:nowplaying', { detail: data }));

  refreshOnDemandMediaSessionMetadata(nowPlaying);
  updateOnDemandMediaSessionPositionState(0, selectedDuration);
}
/* Appends a song to the session queue unless it is already the current entry
   (re-selecting the same track should not create a duplicate step). */
function isSameOnDemandSong(first, second) {
  if (!first || !second) return false;
  if (first.providerTrackId && second.providerTrackId &&
      String(first.providerTrackId) === String(second.providerTrackId)) return true;
  if (first.trackKey && second.trackKey && first.trackKey === second.trackKey) return true;
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const firstTitle = normalize(first.trackName || first.title);
  const secondTitle = normalize(second.trackName || second.title);
  const firstArtist = normalize(first.artistName || first.artist);
  const secondArtist = normalize(second.artistName || second.artist);
  return Boolean(firstTitle && secondTitle && firstArtist && secondArtist &&
    firstTitle === secondTitle && firstArtist === secondArtist);
}

function removeDuplicateOnDemandQueueEntries() {
  if (onDemandQueue.length < 2) return;
  const previousQueue = onDemandQueue;
  const previousFavouriteQueueLength = onDemandFavouriteQueueLength;
  const uniqueQueue = [];
  const indexMap = [];
  previousQueue.forEach((song, previousIndex) => {
    let nextIndex = uniqueQueue.findIndex((queuedSong) => isSameOnDemandSong(queuedSong, song));
    if (nextIndex < 0) {
      nextIndex = uniqueQueue.length;
      uniqueQueue.push(song);
    }
    indexMap[previousIndex] = nextIndex;
  });
  onDemandQueue = uniqueQueue;
  onDemandQueueIndex = indexMap[onDemandQueueIndex] ?? 0;
  onDemandQueueStartIndex = indexMap[onDemandQueueStartIndex] ?? 0;
  onDemandFavouriteQueueLength = previousFavouriteQueueLength > 0
    ? uniqueQueue.filter((song) => previousQueue.some((oldSong, oldIndex) =>
      oldIndex < previousFavouriteQueueLength && isSameOnDemandSong(oldSong, song)
    )).length
    : 0;
  window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
}

function enqueueOnDemandSong(song) {
  const current = onDemandQueue[onDemandQueueIndex];
  const isSameAsCurrent = isSameOnDemandSong(current, song);

  if (isSameAsCurrent) return;

  // Playing a new song after going back truncates the forward history, the way
  // a browser's back/forward stack behaves.
  onDemandQueue = onDemandQueue.slice(0, onDemandQueueIndex + 1);
  onDemandQueue.push(song);
  onDemandQueueIndex = onDemandQueue.length - 1;
  if (onDemandQueue.length === 1) onDemandQueueStartIndex = 0;
  window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
}

function updateTransportButtonState() {
  const hasQueuedPrevious = onDemandQueueIndex > 0;
  const hasQueuedNext = onDemandQueueIndex >= 0 && onDemandQueueIndex < onDemandQueue.length - 1;
  const hasRelatedNext = relatedTrackCursor < relatedTrackCache.length;
  const canGoPrevious = window.onDemandPlaybackActive && hasQueuedPrevious;
  const canGoNext = window.onDemandPlaybackActive && (hasQueuedNext || hasRelatedNext);

  if (onDemandPrevButton) {
    onDemandPrevButton.disabled = !canGoPrevious;
  }
  if (onDemandNextButton) {
    // Next stays enabled while unplayed related tracks remain, so the listener
    // can move on before the current song ends.
    onDemandNextButton.disabled = !canGoNext;
  }

  // Chrome enables notification transport buttons only when these actions are
  // registered. Keep their availability in sync with the same queue state as
  // the in-app buttons, and remove them when returning to live radio.
  if (navigator.mediaSession?.setActionHandler) {
    try {
      navigator.mediaSession.setActionHandler(
        'previoustrack',
        canGoPrevious ? () => skipOnDemandSong(-1) : null
      );
    } catch {
      // Some browsers expose Media Session without supporting every action.
    }
    try {
      navigator.mediaSession.setActionHandler(
        'nexttrack',
        canGoNext ? () => skipOnDemandSong(1) : null
      );
    } catch {
      // Some browsers expose Media Session without supporting every action.
    }
    try {
      navigator.mediaSession.setActionHandler(
        'seekto',
        window.onDemandPlaybackActive
          ? (details) => {
              const seekTime = Number(details?.seekTime);
              if (!Number.isFinite(seekTime)) return;
              const hasSource = Boolean(onDemandAudio?.getAttribute?.('src'));
              if (!hasSource) return;
              onDemandAudio.currentTime = Math.min(Math.max(0, seekTime), onDemandAudio.duration || selectedDuration || Infinity);
              updatePlaybackProgress();
              updateOnDemandMediaSessionPositionState(onDemandAudio.currentTime, onDemandAudio.duration || selectedDuration);
            }
          : null
      );
    } catch {
      // Some browsers expose Media Session without supporting every action.
    }
    try {
      navigator.mediaSession.setActionHandler(
        'seekbackward',
        window.onDemandPlaybackActive
          ? (details) => {
              const skip = Number(details?.seekOffset) || 10;
              const hasSource = Boolean(onDemandAudio?.getAttribute?.('src'));
              if (!hasSource) return;
              onDemandAudio.currentTime = Math.max(0, (onDemandAudio.currentTime || 0) - skip);
              updatePlaybackProgress();
              updateOnDemandMediaSessionPositionState(onDemandAudio.currentTime, onDemandAudio.duration || selectedDuration);
            }
          : null
      );
    } catch {
      // Some browsers expose Media Session without supporting every action.
    }
    try {
      navigator.mediaSession.setActionHandler(
        'seekforward',
        window.onDemandPlaybackActive
          ? (details) => {
              const skip = Number(details?.seekOffset) || 10;
              const hasSource = Boolean(onDemandAudio?.getAttribute?.('src'));
              if (!hasSource) return;
              const duration = onDemandAudio.duration || selectedDuration || Infinity;
              onDemandAudio.currentTime = Math.min(duration, (onDemandAudio.currentTime || 0) + skip);
              updatePlaybackProgress();
              updateOnDemandMediaSessionPositionState(onDemandAudio.currentTime, duration);
            }
          : null
      );
    } catch {
      // Some browsers expose Media Session without supporting every action.
    }
  }
}

function skipOnDemandSong(offset, manual = true) {
  if (manual) autoplayTrackTransition = false;
  if (offset > 0 && onDemandRepeatMode === 'all' &&
      onDemandQueueSource === 'favourites' && onDemandQueue.length > 1 &&
      onDemandQueueIndex === onDemandQueue.length - 1) {
    onDemandQueueIndex = 0;
    window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
    startOnDemandSong(onDemandQueue[0], {
      preserveQueue: true,
      openNowPlaying: false,
      recordRecent: false,
      gapless: !manual
    });
    return;
  }
  if (offset > 0 && manual) {
    const shuffledTrack = takeShuffledAutoplayTrack();
    if (shuffledTrack) {
      playRelatedTrack(shuffledTrack, false);
      return;
    }
  }
  // At the end of the played queue, move into the related list we already
  // fetched rather than trying to walk past the last entry.
  if (offset > 0 && onDemandQueueIndex >= onDemandQueue.length - 1) {
    const nextRelated = relatedTrackCache[relatedTrackCursor];
    if (!nextRelated) {
      if (onDemandRepeatMode === 'all' && onDemandQueue.length > 1 && !isFetchingRelated) {
        onDemandQueueIndex = 0;
        window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
        startOnDemandSong(onDemandQueue[0], {
          preserveQueue: true,
          openNowPlaying: false,
          recordRecent: false,
          gapless: !manual
        });
      }
      return;
    }

    relatedTrackCursor += 1;
    playRelatedTrack(nextRelated, !manual);
    return;
  }

  const nextIndex = onDemandQueueIndex + offset;
  const nextSong = onDemandQueue[nextIndex];
  if (!nextSong) return;

  onDemandQueueIndex = nextIndex;
  window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
  onDemandQueueSource = onDemandFavouriteQueueLength > 0 && nextIndex < onDemandFavouriteQueueLength
    ? 'favourites'
    : 'autoplay';
  updateTransportButtonState();
  // Skips stay in the listener's current view; only fresh picks open Now
  // Playing (see startOnDemandSong).
  startOnDemandSong(nextSong, {
    preserveQueue: true,
    openNowPlaying: false,
    recordRecent: false,
    gapless: !manual
  });
}

onDemandPrevButton?.addEventListener('click', () => skipOnDemandSong(-1));
onDemandNextButton?.addEventListener('click', () => skipOnDemandSong(1));

/* Fetch recommendations from the current autoplay anchor. Keeping the same
   seed across autoplay tracks prevents the radio from drifting into a new
   musical style after each transition on both mobile and desktop. */
async function fetchRelatedTracks(trackId) {
  if (!trackId) return [];
  if (onDemandQueueSource === 'favourites') autoplayAnchorTrackId = trackId;
  if (!autoplayAnchorTrackId) autoplayAnchorTrackId = trackId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const queue = await fetchAutoplayQueue(autoplayAnchorTrackId);
      if (queue.stationid) radioStationId = queue.stationid;
      return queue.tracks.filter((track) => track.id && !playedTrackIds.has(track.id) &&
        !onDemandQueue.some((song) => isSameOnDemandSong(song, relatedTrackToSong(track))) &&
        !NON_CATALOG_TITLE.test(track.title) && !UNOFFICIAL_MIX_TITLE.test(track.title));
    } catch (error) {
      console.warn(
        `Autoplay recommendations request failed (${attempt + 1}/3):`,
        error?.name || 'Error',
        error?.message || String(error),
        `visibility=${document.visibilityState}`,
        `online=${navigator.onLine}`
      );
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
  }

  return null;
}

/* Kicks off a background queue lookup as soon as the current track starts. */
function prefetchRelatedTracks(trackId, isRetry = false) {
  if (!trackId) return;

  if (!isRetry) {
    window.clearTimeout(autoplayPrefetchRetryTimer);
    autoplayPrefetchRetryTimer = 0;
    autoplayPrefetchRetryAttempt = 0;
    autoplayPrefetchFailed = false;
  }

  const token = ++prefetchToken;
  isFetchingRelated = true;

  fetchRelatedTracks(trackId)
    .then((tracks) => {
      // Ignore a response for a track the listener has already moved past.
      if (token !== prefetchToken) return;

      if (!Array.isArray(tracks)) {
        // Keep any already-buffered, unplayed recommendations. A transient
        // fetch failure must not turn a usable queue into an empty one.
        autoplayPrefetchFailed = true;
        autoplayPrefetchRetryAttempt += 1;
        const retryDelay = Math.min(30000, 1000 * (2 ** Math.min(autoplayPrefetchRetryAttempt - 1, 5)));
        window.clearTimeout(autoplayPrefetchRetryTimer);
        autoplayPrefetchRetryTimer = window.setTimeout(() => {
          autoplayPrefetchRetryTimer = 0;
          if (window.onDemandPlaybackActive && currentOnDemandTrackId) {
            prefetchRelatedTracks(currentOnDemandTrackId, true);
          }
        }, retryDelay);
        updateTransportButtonState();
        return;
      }

      autoplayPrefetchFailed = false;
      autoplayPrefetchRetryAttempt = 0;
      window.clearTimeout(autoplayPrefetchRetryTimer);
      autoplayPrefetchRetryTimer = 0;
      const pendingTracks = [
        ...relatedTrackCache.slice(relatedTrackCursor),
        ...tracks
      ];
      const seenTrackIds = new Set();
      relatedTrackCache = pendingTracks.filter((track) => {
        if (!track?.id || playedTrackIds.has(track.id) || seenTrackIds.has(track.id) ||
            onDemandQueue.some((song) => isSameOnDemandSong(song, relatedTrackToSong(track)))) return false;
        seenTrackIds.add(track.id);
        return true;
      });
      relatedTrackCursor = 0;
      shufflePreparedCursor = -1;
      // Give the next few songs time to fetch lyrics while the current track
      // is still playing, even if audio preloading starts later.
      relatedTrackCache.slice(0, 4).forEach((track) => {
        window.prefetchOnDemandLyrics?.(track);
      });
      prefetchUpcomingTrackArtwork();
      if (!handoffOutgoingAudio) {
        if (onDemandQueueSource === 'favourites' &&
            onDemandQueueIndex < onDemandFavouriteQueueLength - 1) {
          preloadNextLikedQueueTrack();
        } else {
          preloadNextAutoplayTrack();
        }
      }
      updateTransportButtonState();
    })
    .finally(() => {
      if (token === prefetchToken) isFetchingRelated = false;
    });
}

function preloadNextAutoplayTrack() {
  const nextTrack = relatedTrackCache[relatedTrackCursor];
  if (!nextTrack?.id || !nextTrack.streamUrl ||
      nextTrack.id === autoplayPreloadedTrackId) return;
  preloadTrackAudio(nextTrack);
}

function preloadTrackAudio(track) {
  if (!track?.id || !track.streamUrl ||
      (track.id === autoplayPreloadedTrackId &&
       track.streamUrl === autoplayPreloadedStreamUrl)) return;
  // Also cover cases where audio is preloaded before a recommendation queue
  // is available.
  window.prefetchOnDemandLyrics?.(track);
  autoplayPreloadedTrackId = track.id;
  autoplayPreloadedStreamUrl = track.streamUrl;
  autoplayPreloadAudio.src = track.streamUrl;
  // Explicit load() asks the browser to start buffering this media now while
  // the active audio element continues playing the current song.
  autoplayPreloadAudio.load();
}

function isPreloadedTrackReady(trackId, streamUrl = '') {
  const sourceMatches = streamUrl
    ? autoplayPreloadedStreamUrl === streamUrl
    : autoplayPreloadedTrackId === trackId;
  if (!trackId || !sourceMatches || !autoplayPreloadedStreamUrl ||
      autoplayPreloadAudio.error || autoplayPreloadAudio.readyState < 2) return false;
  if (autoplayPreloadAudio.readyState >= 3) return true;
  const currentTime = Number(autoplayPreloadAudio.currentTime) || 0;
  for (let index = 0; index < autoplayPreloadAudio.buffered.length; index += 1) {
    const start = autoplayPreloadAudio.buffered.start(index);
    const end = autoplayPreloadAudio.buffered.end(index);
    // If the browser has not raised HAVE_FUTURE_DATA yet, don't promote on a
    // single decoded frame. A few seconds of actual buffered audio keeps the
    // incoming track from stalling after the outgoing track starts fading.
    if (end >= currentTime && end - Math.max(start, currentTime) >= 3) return true;
  }
  return false;
}

function waitForPreloadedTrack(track, timeoutMs = 10000) {
  if (!track?.id || !track.streamUrl) return Promise.resolve(false);
  preloadTrackAudio(track);
  if (isPreloadedTrackReady(track.id, track.streamUrl)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
      ['loadeddata', 'canplay', 'progress', 'error'].forEach((eventName) =>
        autoplayPreloadAudio.removeEventListener(eventName, check)
      );
      resolve(ready);
    };
    const check = () => {
      if (isPreloadedTrackReady(track.id, track.streamUrl)) finish(true);
      else if (autoplayPreloadAudio.error) finish(false);
    };
    const pollTimer = window.setInterval(check, 100);
    const timeoutTimer = window.setTimeout(() => finish(false), timeoutMs);
    ['loadeddata', 'canplay', 'progress', 'error'].forEach((eventName) =>
      autoplayPreloadAudio.addEventListener(eventName, check)
    );
    check();
  });
}

async function promoteTrackForHandoff(track, waitForReady) {
  if (promotePreloadedTrack(track)) return true;
  if (!waitForReady || !await waitForPreloadedTrack(track)) return false;
  return promotePreloadedTrack(track);
}

function preloadRepeatAllWrapTrack() {
  if (onDemandRepeatMode !== 'all' || onDemandQueueSource !== 'favourites') return;
  if (!(onDemandQueue.length > 1 && onDemandQueueIndex === onDemandQueue.length - 1)) return;
  const firstSong = onDemandQueue[0];
  if (!firstSong) return;
  const key = likedQueuePreparationKey(firstSong);
  let preparation = likedQueuePreparations.get(key);
  if (!preparation) {
    preparation = resolveLikedQueueTrack(firstSong);
    likedQueuePreparations.set(key, preparation);
  }
  Promise.resolve(preparation).then((track) => {
    if (onDemandRepeatMode !== 'all' || onDemandQueue[0] !== firstSong) return;
    if (!track?.id || !track.streamUrl || handoffOutgoingAudio) return;
    if (autoplayPreloadedTrackId === track.id) return;
    preloadTrackAudio(track);
  }).catch(() => {});
}

function preloadNextLikedQueueTrack(queueIndex = onDemandQueueIndex) {
  if (onDemandQueueSource !== 'favourites' || queueIndex < 0 ||
      queueIndex >= onDemandFavouriteQueueLength - 1) return;
  const nextSong = onDemandQueue[queueIndex + 1];
  if (!nextSong) return;
  const key = likedQueuePreparationKey(nextSong);
  let preparation = likedQueuePreparations.get(key);
  if (!preparation) {
    preparation = resolveLikedQueueTrack(nextSong);
    likedQueuePreparations.set(key, preparation);
  }
  Promise.resolve(preparation).then((track) => {
    if (onDemandQueueSource !== 'favourites' ||
        onDemandQueue[onDemandQueueIndex + 1] !== nextSong ||
        !track?.id || !track.streamUrl || handoffOutgoingAudio) return;
    preloadTrackAudio(track);
  }).catch(() => {});
}

/* Normalises a queue track into the song shape the rest of the module uses
   (startOnDemandSong and updateOnDemandMetadata both expect trackName/
   artistName/artworkUrl100, matching the iTunes catalog shape). */
function relatedTrackToSong(track) {
  return {
    trackName: track.title || 'Unknown song',
    artistName: (track.artist || '').replace(/\s-\sTopic$/i, '').trim(),
    collectionName: track.album || '',
    primaryGenreName: track.primaryGenreName || '',
    artworkUrl100: track.thumbnail || '',
    trackTimeMillis: (track.durationSeconds || parseDurationString(track.duration) || 0) * 1000,
    providerTrackId: track.id,
    providerArtistIds: track.artistIds || [],
    providerAlbumId: track.albumId || '',
    streamUrl: track.streamUrl || ''
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

/* Called when a track ends. Plays the next prefetched queue item. */
function advanceToSimilarSong() {
  if (!window.onDemandPlaybackActive) return;

  if (onDemandRepeatMode === 'one' && onDemandAudio?.getAttribute('src')) {
    const repeatTrack = getCurrentOnDemandRepeatTrack();
    const promoted = repeatTrack && promotePreloadedTrack(repeatTrack);
    if (promoted) {
      // The same song is already buffered on the standby element. Promoting it
      // lets the normal handoff path crossfade into the next repeat.
      onDemandAudio.currentTime = 0;
      onDemandAudio.play().catch(() => {});
    } else {
      // Keep repeat-one working if the standby copy was not ready in time.
      onDemandAudio.currentTime = 0;
      onDemandAudio.play().catch(() => {});
    }
    autoplayTrackTransition = false;
    setOnDemandPlaying(true);
    return;
  }

  if (onDemandQueueIndex >= 0 && onDemandQueueIndex < onDemandQueue.length - 1) {
    skipOnDemandSong(1, false);
    return;
  }

  if (onDemandRepeatMode === 'all' && onDemandQueueSource === 'favourites' &&
      onDemandQueue.length > 1) {
    onDemandQueueIndex = 0;
    window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
    startOnDemandSong(onDemandQueue[0], {
      preserveQueue: true,
      openNowPlaying: false,
      recordRecent: false,
      gapless: true
    });
    return;
  }

  // Finish the already-fetched recommendation queue before wrapping. The
  // queue grows as those recommendations are played, so Repeat All includes
  // every track in the current recommendation batch.
  const shuffledTrack = takeShuffledAutoplayTrack();
  if (shuffledTrack) {
    playRelatedTrack(shuffledTrack);
    return;
  }

  shuffleUpcomingRelatedTrack();
  const nextTrack = relatedTrackCache[relatedTrackCursor];
  if (nextTrack) {
    relatedTrackCursor += 1;
    playRelatedTrack(nextTrack);
    return;
  }

  if (onDemandRepeatMode === 'all' && onDemandQueue.length > 1 &&
      !isFetchingRelated && !autoplayPrefetchFailed) {
    onDemandQueueIndex = 0;
    window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
    startOnDemandSong(onDemandQueue[0], {
      preserveQueue: true,
      openNowPlaying: false,
      recordRecent: false,
      gapless: true
    });
    return;
  }

  // The prefetch has not landed yet (or returned no eligible tracks). Wait for
  // the in-flight request or a scheduled transient-error retry before stopping.
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
      if (autoplayPrefetchFailed) {
        // A failed recommendation request is transient; leave the player in
        // its waiting state while the scheduled retry rebuilds the queue.
        attempts = 0;
        return;
      }
      if (onDemandRepeatMode === 'all' && onDemandQueue.length > 1) {
        window.clearInterval(autoplayRetryTimer);
        onDemandQueueIndex = 0;
        window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
        startOnDemandSong(onDemandQueue[0], {
          preserveQueue: true,
          openNowPlaying: false,
          recordRecent: false,
          gapless: true
        });
        return;
      }
      window.clearInterval(autoplayRetryTimer);
      autoplayTrackTransition = false;
      onDemandModeLabel.textContent = 'ON DEMAND';
      // Surface the reason in the station slot: the mode label is hidden while
      // on-demand is active, so without this the player just stops silently.
      onDemandStation.textContent = 'No more similar songs';
      setOnDemandPlaying(false);
    }
  }, 250);
}

function shuffleUpcomingRelatedTrack(forceDifferentNext = false) {
  const remainingCount = relatedTrackCache.length - relatedTrackCursor;
  if (!onDemandShuffle || remainingCount <= 0 ||
      (!forceDifferentNext && shufflePreparedCursor === relatedTrackCursor)) return;
  let randomOffset = Math.floor(Math.random() * remainingCount);
  if (forceDifferentNext && remainingCount > 1 && randomOffset === 0) {
    randomOffset = 1 + Math.floor(Math.random() * (remainingCount - 1));
  }
  const randomIndex = relatedTrackCursor + randomOffset;
  [relatedTrackCache[relatedTrackCursor], relatedTrackCache[randomIndex]] =
    [relatedTrackCache[randomIndex], relatedTrackCache[relatedTrackCursor]];
  shufflePreparedCursor = relatedTrackCursor;
}

function getCurrentOnDemandRepeatTrack() {
  const candidate = trackCandidates[trackCandidateIndex] || trackCandidates[0];
  const id = currentOnDemandTrackId || candidate?.id || '';
  const streamUrl = candidate?.streamUrl || '';
  return id && streamUrl ? { id, streamUrl } : null;
}

function takeShuffledAutoplayTrack() {
  if (!onDemandShuffle || onDemandQueueSource === 'favourites') return null;
  shuffleUpcomingRelatedTrack();
  const track = relatedTrackCache[relatedTrackCursor];
  if (!track) return null;
  relatedTrackCursor += 1;
  // Discard stale forward history so Previous follows the shuffled playback.
  onDemandQueue = onDemandQueue.slice(0, onDemandQueueIndex + 1);
  onDemandQueueIndex = onDemandQueue.length - 1;
  window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
  return track;
}

function shuffleOnDemandQueueAfterCurrent() {
  if (!onDemandShuffle) return;
  const futureTracks = onDemandQueue.slice(onDemandQueueIndex + 1);
  for (let index = onDemandQueue.length - 1; index > onDemandQueueIndex + 1; index -= 1) {
    const randomIndex = onDemandQueueIndex + 1 + Math.floor(Math.random() * (index - onDemandQueueIndex));
    [onDemandQueue[index], onDemandQueue[randomIndex]] =
      [onDemandQueue[randomIndex], onDemandQueue[index]];
  }
  const shuffledFutureTracks = onDemandQueue.slice(onDemandQueueIndex + 1);
  if (futureTracks.length > 1 && futureTracks.every((song, index) => song === shuffledFutureTracks[index])) {
    [onDemandQueue[onDemandQueueIndex + 1], onDemandQueue[onDemandQueueIndex + 2]] =
      [onDemandQueue[onDemandQueueIndex + 2], onDemandQueue[onDemandQueueIndex + 1]];
  }
  window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
  shufflePreparedCursor = -1;
  shuffleUpcomingRelatedTrack(true);
}

function setOnDemandShuffle(enabled) {
  const shouldShuffle = Boolean(enabled);
  if (shouldShuffle === onDemandShuffle) return;

  if (shouldShuffle) {
    shuffleNormalQueueFuture = onDemandQueue.slice(onDemandQueueIndex + 1);
    shuffleNormalRelatedFuture = relatedTrackCache.slice(relatedTrackCursor);
    shuffleSessionPlayedIds = new Set();
    shuffleSessionPlayedKeys = new Set();
    onDemandShuffle = true;
    shuffleOnDemandQueueAfterCurrent();
  } else {
    onDemandShuffle = false;

    if (shuffleNormalQueueFuture) {
      const historyThroughCurrent = onDemandQueue.slice(0, onDemandQueueIndex + 1);
      const currentSong = onDemandQueue[onDemandQueueIndex];
      // Find where the current song sits in the pre-shuffle (original) queue so
      // we continue with the remaining songs in their original order, instead of
      // restoring the full old queue or keeping the shuffled order.
      const currentIndexInNormal = shuffleNormalQueueFuture.findIndex((song) => {
        const id = song?.providerTrackId ? String(song.providerTrackId) : '';
        const key = song?.trackKey || `${song?.trackName || ''}|${song?.artistName || ''}`.toLowerCase();
        const curId = currentSong?.providerTrackId ? String(currentSong.providerTrackId) : '';
        const curKey = currentSong?.trackKey || `${currentSong?.trackName || ''}|${currentSong?.artistName || ''}`.toLowerCase();
        return (id && id === curId) || (key && key === curKey);
      });
      const normalFuture = (currentIndexInNormal >= 0
        ? shuffleNormalQueueFuture.slice(currentIndexInNormal + 1)
        : shuffleNormalQueueFuture
      );
      onDemandQueue = [...historyThroughCurrent, ...normalFuture];
      onDemandQueueIndex = historyThroughCurrent.length - 1;
      window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
    }

    if (shuffleNormalRelatedFuture) {
      const currentPending = relatedTrackCache.slice(relatedTrackCursor);
      const restored = shuffleNormalRelatedFuture.filter((track) =>
        !shuffleSessionPlayedIds.has(String(track?.id || ''))
      );
      const seenIds = new Set(restored.map((track) => String(track?.id || '')));
      relatedTrackCache = [
        ...restored,
        ...currentPending.filter((track) => {
          const id = String(track?.id || '');
          if (!id || shuffleSessionPlayedIds.has(id) || seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        })
      ];
      relatedTrackCursor = 0;
      shufflePreparedCursor = -1;
    }

    shuffleNormalQueueFuture = null;
    shuffleNormalRelatedFuture = null;
    shuffleSessionPlayedIds.clear();
    shuffleSessionPlayedKeys.clear();
  }

  updateTransportButtonState();
  updateOnDemandModeControls();
  updatePlaybackProgress();
}

function updateOnDemandModeControls() {
  if (onDemandShuffleButton) {
    onDemandShuffleButton.setAttribute('aria-pressed', String(onDemandShuffle));
    onDemandShuffleButton.setAttribute('aria-label', `Shuffle ${onDemandShuffle ? 'on' : 'off'}`);
    onDemandShuffleButton.classList.toggle('is-active', onDemandShuffle);
  }
  if (onDemandRepeatButton) {
    onDemandRepeatButton.setAttribute('aria-pressed', String(onDemandRepeatMode !== 'off'));
    onDemandRepeatButton.setAttribute('aria-label', `Repeat ${onDemandRepeatMode}`);
    onDemandRepeatButton.dataset.repeatMode = onDemandRepeatMode;
    onDemandRepeatButton.classList.toggle('is-active', onDemandRepeatMode !== 'off');
    if (onDemandRepeatOneBadge) {
      onDemandRepeatOneBadge.hidden = onDemandRepeatMode !== 'one';
    }
  }
}
onDemandShuffleButton?.addEventListener('click', () => {
  setOnDemandShuffle(!onDemandShuffle);
});
onDemandRepeatButton?.addEventListener('click', () => {
  onDemandRepeatMode = onDemandRepeatMode === 'off'
    ? 'one'
    : onDemandRepeatMode === 'one'
      ? 'all'
      : 'off';
  if (onDemandRepeatMode === 'all') {
    removeDuplicateOnDemandQueueEntries();
    // Repeat One may have the current song sitting in the standby audio
    // element. Repeat All needs the next queue song there instead, or the
    // upcoming handoff can miss its crossfade window.
    clearAutoplayPreload();
    autoplayTrackTransition = false;
    if (onDemandQueueSource === 'favourites') {
      if (onDemandQueueIndex === onDemandQueue.length - 1) {
        preloadRepeatAllWrapTrack();
      } else {
        preloadNextLikedQueueTrack();
      }
    } else {
      preloadNextAutoplayTrack();
    }
  }
  updateOnDemandModeControls();
});
updateOnDemandModeControls();

/* Starts a track that came from the queue list. It already has a resolved
   stream, so it skips the search round-trip that startOnDemandSong performs. */
async function playRelatedTrack(track, gapless = true) {
  const scheduledHandoff = Boolean(gapless && autoplayTrackTransition && currentOnDemandSong);
  const previousSong = currentOnDemandSong;
  const previousQueueIndex = previousSong
    ? onDemandQueue.findIndex((queuedSong) => isSameOnDemandSong(queuedSong, previousSong))
    : -1;
  const previousQueueLength = onDemandQueue.length;
  const previousSelectedDuration = selectedDuration;
  setOnDemandAudioReady(false);
  if (!gapless) {
    finishOnDemandHandoff();
    clearAutoplayPreload();
  }
  const artworkPromise = prefetchTrackArtwork(track);
  const song = relatedTrackToSong(track);
  const requestId = ++songRequestId;

  const existingQueueIndex = onDemandQueue.findIndex((queuedSong) =>
    isSameOnDemandSong(queuedSong, song)
  );
  if (existingQueueIndex >= 0) {
    onDemandQueueIndex = existingQueueIndex;
  } else {
    onDemandQueue.push(song);
    onDemandQueueIndex = onDemandQueue.length - 1;
  }
  onDemandQueueSource = onDemandFavouriteQueueLength > 0 &&
    onDemandQueueIndex < onDemandFavouriteQueueLength
    ? 'favourites'
    : 'autoplay';
  window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
  updateNowPlayingSubtitle(true);
  updateTransportButtonState();

  resetScrub();

  // Keep the same candidate-fallback the search path uses, even though this
  // track arrives with its stream already resolved.
  trackCandidates = [{ id: track.id, streamUrl: track.streamUrl }].filter((entry) => entry.streamUrl);
  trackCandidateIndex = 0;
  rerresolvedTrackId = '';

  // For a scheduled fade, keep current metadata paired with the active audio
  // until the next source has actually been promoted.
  if (!scheduledHandoff) {
    song.providerArtistIds = track.artistIds || [];
    song.providerAlbumId = track.albumId || '';
    setCurrentOnDemandTrack(song, track.id);
    persistCurrentOnDemandSession();
    updateOnDemandMetadata(song, { id: track.id, title: track.title, artist: track.artist, album: track.album, thumbnail: track.thumbnail });
  }
  void artworkPromise.then((artworkUrl) => {
    if (!artworkUrl || currentOnDemandTrackId !== track.id) return;
    song.artworkUrl100 = artworkUrl;
    setCurrentOnDemandTrack(song, track.id);
    persistCurrentOnDemandSession();
    updateOnDemandMetadata(song, { id: track.id, title: track.title, artist: track.artist, album: track.album, thumbnail: track.thumbnail });
  });
  prefetchUpcomingTrackArtwork();
  if (gapless) {
    const promoted = await promoteTrackForHandoff(track, autoplayTrackTransition);
    if (requestId !== songRequestId) return;
    if (!promoted && (autoplayTrackTransition || scheduledHandoff)) {
      logOnDemand('scheduled related-track handoff could not promote its preload', track.id);
      if (scheduledHandoff) {
        if (existingQueueIndex < 0 && onDemandQueue.length > previousQueueLength) {
          onDemandQueue.pop();
        }
        if (previousQueueIndex >= 0) {
          onDemandQueueIndex = previousQueueIndex;
          onDemandQueueSource = onDemandFavouriteQueueLength > 0 &&
            previousQueueIndex < onDemandFavouriteQueueLength
            ? 'favourites'
            : 'autoplay';
        }
        selectedDuration = previousSelectedDuration;
        window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
        updateTransportButtonState();
        autoplayTrackTransition = false;
        onDemandModeLabel.textContent = 'ON DEMAND';
        setOnDemandAudioReady(true);
        if (onDemandAudio.ended) {
          try { onDemandAudio.currentTime = 0; } catch { /* ended audio may reject the seek */ }
          onDemandAudio.play().catch(() => {});
        }
        return;
      }
    }
  } else {
    clearAutoplayPreload();
  }
  if (scheduledHandoff) {
    selectedDuration = track.durationSeconds || parseDurationString(track.duration) || 0;
    song.providerArtistIds = track.artistIds || [];
    song.providerAlbumId = track.albumId || '';
    setCurrentOnDemandTrack(song, track.id);
    persistCurrentOnDemandSession();
    updateOnDemandMetadata(song, { id: track.id, title: track.title, artist: track.artist, album: track.album, thumbnail: track.thumbnail });
  }
  await loadTrack(trackCandidates[0] || { id: track.id, streamUrl: track.streamUrl }, requestId);
  if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
  updatePlaybackProgress();
  rememberOnDemandPlayback(song);
  // Chain: fetch the continuation queue for this track immediately.
  playedTrackIds.add(track.id);
  prefetchRelatedTracks(track.id);
}

async function startOnDemandSong(song, {
  preserveQueue = false,
  openNowPlaying = true,
  recordRecent = !preserveQueue,
  gapless = true
} = {}) {
  if (!song?.trackName) return;
  const scheduledHandoff = Boolean(gapless && autoplayTrackTransition && currentOnDemandSong);
  const previousSong = currentOnDemandSong;
  const previousQueueIndex = previousSong
    ? onDemandQueue.findIndex((queuedSong) => isSameOnDemandSong(queuedSong, previousSong))
    : -1;
  setOnDemandAudioReady(false);
  void prepareOnDemandFadeAudio();
  if (!gapless) {
    finishOnDemandHandoff();
    clearAutoplayPreload();
  }
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
  const hadProviderTrackId = Boolean(song.providerTrackId);
  if (!preserveQueue) {
    const current = onDemandQueue[onDemandQueueIndex];
    const isSameAsCurrent = isSameOnDemandSong(current, song);
    if (!isSameAsCurrent) {
      clearAutoplayPreload();
      // A listener's new selection starts a fresh history. Autoplay tracks
      // added afterward can still be played next and navigated back to.
      onDemandQueue = [];
      onDemandQueueIndex = -1;
      onDemandQueueStartIndex = 0;
      onDemandQueueSessionId = createOnDemandQueueSessionId();
      onDemandQueueSource = 'autoplay';
      onDemandFavouriteQueueLength = 0;
      playedTrackIds.clear();
      relatedTrackCache = [];
      relatedTrackCursor = 0;
      isFetchingRelated = false;
      window.clearTimeout(autoplayPrefetchRetryTimer);
      autoplayPrefetchRetryTimer = 0;
      autoplayPrefetchRetryAttempt = 0;
      autoplayPrefetchFailed = false;
      autoplayAnchorTrackId = '';
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
      updateOnDemandMetadata(song, { id: currentOnDemandTrackId });
    }
  });
  const requestId = ++songRequestId;
  if (!scheduledHandoff) selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  enqueueOnDemandSong(song);
  window.prefetchOnDemandLyricsQueue?.(onDemandQueue, onDemandQueueIndex, 4);
  if (recordRecent) {
    const fromLikedFolder = song.recentDisplayType === 'liked-folder' ||
      (preserveQueue && onDemandQueueSource === 'favourites');
    rememberOnDemandSong(song, { fromLikedFolder });
  }
  updateTransportButtonState();
  resetScrub();
  window.onDemandPlaybackActive = true;
  document.body.classList.toggle('on-demand-paused', window.onDemandPlaying !== true);
  startOnDemandSilentLoop();

  updateTransportButtonState();
  savePlaybackMode('on-demand');
  updateNowPlayingSubtitle(true);
  window.setOnDemandAudioQuality?.(true);
  document.body.classList.add('on-demand-active');
  window.pauseLiveStreamForOnDemand?.();
  returnToLiveButton.hidden = false;

  // Reveal the mini player and paint the title/artist/artwork the instant the
  // listener picks a track. The search + stream load below can take a moment;
  // previously the docked player stayed hidden until audio actually started,
  // so nothing appeared to happen on tap. The audio keeps loading behind the
  // now-visible mini player.
  window.revealMiniPlayer?.();
  if (!scheduledHandoff) updateOnDemandMetadata(song, {});

  if (!scheduledHandoff) onDemandModeLabel.textContent = 'Hang on';
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

    // History entries created by autoplay already carry a resolved JioSaavn id
    // and stream URL — reuse them so navigating back skips the search. Legacy
    // rows that only hold an old YouTube video id intentionally fall through to
    // a fresh JioSaavn search: this player has no YouTube sources left.
    let track = null;
    const preparation = likedQueuePreparations.get(likedQueuePreparationKey(song));
    if (preparation) {
      try { track = await preparation; } catch { /* Fall back to a fresh lookup below. */ }
    }
    if (!track?.streamUrl) track = await resolveLikedQueueTrack(song);
    if (requestId !== songRequestId) return;

    let promoted = false;
    if (gapless) {
      promoted = await promoteTrackForHandoff(track, autoplayTrackTransition);
      if (requestId !== songRequestId) return;
      if (!promoted && (autoplayTrackTransition || scheduledHandoff)) {
        logOnDemand('scheduled queue-track handoff could not promote its preload', track.id);
        if (scheduledHandoff) {
          // Keep the outgoing song and its metadata together. The active audio
          // source is untouched, so its progress handler can retry the fade.
          if (previousQueueIndex >= 0) {
            onDemandQueueIndex = previousQueueIndex;
            onDemandQueueSource = onDemandFavouriteQueueLength > 0 &&
              previousQueueIndex < onDemandFavouriteQueueLength
              ? 'favourites'
              : 'autoplay';
          }
          window.dispatchEvent(new CustomEvent('thaalam-on-demand-history-change'));
          updateTransportButtonState();
          autoplayTrackTransition = false;
          onDemandModeLabel.textContent = 'ON DEMAND';
          setOnDemandAudioReady(true);
          if (onDemandAudio.ended) {
            try { onDemandAudio.currentTime = 0; } catch { /* ended audio may reject the seek */ }
            onDemandAudio.play().catch(() => {});
          }
          return;
        }
      }
    } else {
      clearAutoplayPreload();
    }
    trackCandidates = [track, ...(track.alternatives || [])]
      .filter((candidate) => candidate?.streamUrl);
    trackCandidateIndex = 0;
    rerresolvedTrackId = '';
    selectedDuration = track.durationSeconds
      || parseDurationString(track.duration)
      || selectedDuration;
    song.providerTrackId = track.id;
    song.providerArtistIds = track.artistIds || song.providerArtistIds || [];
    song.providerAlbumId = track.albumId || song.providerAlbumId || '';
    song.streamUrl = track.streamUrl;
    if (!hadProviderTrackId && song.trackKey) {
      window.saveLikedSongPlaybackIdentity?.(song);
    }
    setCurrentOnDemandTrack(song, track.id);
    persistCurrentOnDemandSession();
    updateOnDemandMetadata(song, track);
    await loadTrack(trackCandidates[0] || { id: track.id, streamUrl: track.streamUrl }, requestId);
    if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
    updatePlaybackProgress();
    rememberOnDemandPlayback(song);
    playedTrackIds.add(track.id);
    prefetchRelatedTracks(track.id);
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

function startOnDemandQueue(songs, startIndex = 0, options = {}) {
  const sourceQueue = Array.isArray(songs)
    ? songs.filter((song) => song?.trackName)
    : [];
  const queue = [];
  const sourceIndexToQueueIndex = [];
  sourceQueue.forEach((song, sourceIndex) => {
    let queueIndex = queue.findIndex((queuedSong) => isSameOnDemandSong(queuedSong, song));
    if (queueIndex < 0) {
      queueIndex = queue.length;
      queue.push(song);
    }
    sourceIndexToQueueIndex[sourceIndex] = queueIndex;
  });
  if (!queue.length) return;

  const sourceSelectedIndex = Math.max(0, Math.min(sourceQueue.length - 1, Number(startIndex) || 0));
  const selectedIndex = sourceIndexToQueueIndex[sourceSelectedIndex] ?? 0;
  const selectedSong = queue[selectedIndex];
  const selectedKey = likedQueuePreparationKey(selectedSong);
  // Mobile taps can fire again while a liked track is still resolving. Reuse
  // that in-flight start so repeated taps don't reset the queue or launch
  // competing searches for the same song.
  if (selectedKey && selectedKey === pendingLikedQueueStartKey && pendingLikedQueueStart) {
    return pendingLikedQueueStart;
  }

  clearAutoplayPreload();
  onDemandQueue = queue;
  onDemandQueueIndex = selectedIndex;
  onDemandQueueStartIndex = selectedIndex;
  onDemandQueueSessionId = createOnDemandQueueSessionId();
  onDemandQueueSource = 'favourites';
  onDemandFavouriteQueueLength = queue.length;
  playedTrackIds.clear();
  relatedTrackCache = [];
  relatedTrackCursor = 0;
  isFetchingRelated = false;
  window.clearTimeout(autoplayPrefetchRetryTimer);
  autoplayPrefetchRetryTimer = 0;
  autoplayPrefetchRetryAttempt = 0;
  autoplayPrefetchFailed = false;
  autoplayAnchorTrackId = '';
  prefetchToken += 1;
  prepareLikedQueue(queue, selectedIndex);
  updateTransportButtonState();

  pendingLikedQueueStartKey = selectedKey;
  const start = startOnDemandSong(selectedSong, {
    ...options,
    preserveQueue: true,
    recordRecent: true
  });
  let trackedStart;
  trackedStart = Promise.resolve(start).finally(() => {
    if (pendingLikedQueueStart === trackedStart) {
      pendingLikedQueueStart = null;
      pendingLikedQueueStartKey = '';
    }
  });
  pendingLikedQueueStart = trackedStart;
  return pendingLikedQueueStart;
}

function toggleOnDemandPlayback(shouldPlay) {
  if (!onDemandAudio.getAttribute('src')) return;
  const isPlaying = !onDemandAudio.paused && !onDemandAudio.ended;
  if (shouldPlay === false || (shouldPlay !== true && isPlaying)) {
    pendingShouldPlay = false;
    onDemandAudio.pause();
  } else {
    void prepareOnDemandFadeAudio();
    const playPromise = onDemandAudio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        logOnDemand('toggle play() rejected:', error?.name || error);
        if (window.onDemandPlaybackActive) setOnDemandPlaying(false);
      });
    }
  }
}

/* Restores the saved on-demand track, queue and transport state after a
   refresh or reopen. */
async function restoreOnDemandSession() {
  logOnDemand('restoreOnDemandSession() called');
  void prepareOnDemandFadeAudio();
  const stored = readOnDemandSession();
  if (!stored) {
    logOnDemand('ABORT: nothing to restore');
    return;
  }

  const song = stored.song;
  setOnDemandAudioReady(false);
  savePlaybackMode('on-demand');
  // Restore the current song and queue paused on every device. Starting audio
  // after an app reopen always requires an explicit play action.
  const shouldResume = false;
  // Keep the session's navigation history across refreshes. Entries without a
  // track name are dropped; entries missing a resolved stream re-search on tap.
  const savedQueue = Array.isArray(stored.queue)
    ? stored.queue.filter((entry) => entry?.trackName)
    : [];
  const savedIndex = Number.isInteger(stored.queueIndex) ? stored.queueIndex : -1;
  autoplayAnchorTrackId = String(stored.autoplayAnchorTrackId || '');
   onDemandShuffle = stored.shuffle === true;
   onDemandRepeatMode = (stored.repeatMode === 'one' || stored.repeatMode === 'all') ? stored.repeatMode : 'off';

  if (savedQueue.length && savedIndex >= 0 && savedIndex < savedQueue.length) {
    onDemandQueue = savedQueue;
    onDemandQueueIndex = savedIndex;
    onDemandQueueStartIndex = Number.isInteger(stored.queueStartIndex)
      ? stored.queueStartIndex
      : savedIndex;
    onDemandQueueSessionId = String(stored.queueSessionId || createOnDemandQueueSessionId());
    onDemandFavouriteQueueLength = Math.max(
      0,
      Math.min(savedQueue.length, Number(stored.favouriteQueueLength) || 0)
    );
    onDemandQueueSource = onDemandFavouriteQueueLength > 0 && savedIndex < onDemandFavouriteQueueLength
      ? 'favourites'
      : 'autoplay';
    playedTrackIds.clear();
    savedQueue.forEach((entry) => {
      if (entry?.providerTrackId) playedTrackIds.add(entry.providerTrackId);
    });
     if (onDemandShuffle) {
       shuffleSessionPlayedIds = new Set();
       shuffleSessionPlayedKeys = new Set();
       savedQueue.slice(0, savedIndex + 1).forEach((entry) => {
         if (entry?.providerTrackId) shuffleSessionPlayedIds.add(String(entry.providerTrackId));
         const key = entry?.trackKey || `${entry?.trackName || ''}|${entry?.artistName || ''}`.toLowerCase();
         if (key) shuffleSessionPlayedKeys.add(key);
       });
     }

    // The session song/track are authoritative for the currently loaded item.
    onDemandQueue[onDemandQueueIndex] = { ...song, providerTrackId: stored.trackId };
  } else {
    onDemandQueue = [];
    onDemandQueueIndex = -1;
    onDemandQueueStartIndex = 0;
    onDemandQueueSessionId = createOnDemandQueueSessionId();
    onDemandQueueSource = 'autoplay';
    onDemandFavouriteQueueLength = 0;
    enqueueOnDemandSong({ ...song, providerTrackId: stored.trackId });
  }
  // Enter the same on-demand state a fresh selection would, before any live
  // radio UI can repaint itself over the restored track.
  window.onDemandPlaybackActive = true;
  document.body.classList.add('on-demand-paused');
  startOnDemandSilentLoop();

  updateNowPlayingSubtitle(true);
  window.setOnDemandAudioQuality?.(true);
  document.body.classList.add('on-demand-active');
  window.pauseLiveStreamForOnDemand?.();
  returnToLiveButton.hidden = false;
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;
  onDemandPlayButton?.classList.add('is-loading');
  onDemandMiniToggle?.classList.add('is-loading');
  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  updateTransportButtonState();
   updateOnDemandModeControls();

  const requestId = ++songRequestId;
  setCurrentOnDemandTrack(song, stored.trackId, stored.position || 0);
  syncDesktopNowPlayingTab();
  window.updateStoredRatingForCurrentSong?.(window.currentNowPlayingSong);

  try {
    // Resolve a stream URL: the session may hold one, but it can be stale, so
    // fall back to a fresh server-side resolution when it is missing.
    let streamUrl = String(song.streamUrl || '');
    if (!streamUrl) {
      const fresh = await resolveSong(stored.trackId);
      streamUrl = fresh?.streamUrl || '';
      if (streamUrl) {
        song.streamUrl = streamUrl;
        if (fresh.thumbnail && !song.artworkUrl100) song.artworkUrl100 = fresh.thumbnail;
        persistCurrentOnDemandSession();
      }
    }
    if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
    if (!streamUrl) throw new Error('Song Not playable');

    trackCandidates = [{ id: stored.trackId, streamUrl }];
    trackCandidateIndex = 0;
    rerresolvedTrackId = '';
    updateOnDemandMetadata(song, { id: stored.trackId, thumbnail: song.artworkUrl100 || '' });
    await loadTrack(trackCandidates[0], requestId, stored.position || 0, shouldResume);
    logOnDemand('loadTrack() resolved; src =', Boolean(onDemandAudio.getAttribute('src')),
      'state =', onDemandAudio.paused ? 'paused' : 'playing');
    if (requestId !== songRequestId || !window.onDemandPlaybackActive) {
      logOnDemand('ABORT after loadTrack: superseded or no longer on-demand');
      return;
    }

    updatePlaybackProgress();
    playedTrackIds.add(stored.trackId);
    prefetchRelatedTracks(stored.trackId);
    preloadNextLikedQueueTrack(onDemandQueueIndex);
    // Reflect the media element's real state after restoring it paused.
    setOnDemandPlaying(!onDemandAudio.paused && !onDemandAudio.ended);
  } catch (error) {
    console.error('Unable to restore on-demand playback:', error);
    // A failed restore must not silently drop the listener back to the radio:
    // they would come back to a different station and no sign their track ever
    // existed. Stay in on-demand mode, keep the artwork/title/Back to Live
    // already on screen, and let the transport retry instead. returnToLive()
    // runs only on an explicit press.
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
  savePlaybackMode('live');
  songRequestId += 1;
  // Stop and release the stream so nothing keeps buffering in the background.
  pendingShouldPlay = false;
  autoplayTrackTransition = false;
  pendingStartSeconds = -1;
  onDemandAudio.pause();
  setOnDemandPlaying(false);
  // Keep the last on-demand track, its playhead and queue so the mode pill can
  // restore it as a paused session when the listener switches back.
  persistCurrentOnDemandSession();
  onDemandAudio.removeAttribute('src');
  onDemandAudio.load();
  clearAutoplayPreload();
  resetScrub();
  // Cancel any in-flight related-tracks lookup so a late response cannot
  // restart on-demand playback after the listener has gone back to live.
  window.clearInterval(autoplayRetryTimer);
  window.clearTimeout(autoplayPrefetchRetryTimer);
  autoplayPrefetchRetryTimer = 0;
  autoplayPrefetchRetryAttempt = 0;
  autoplayPrefetchFailed = false;
  prefetchToken += 1;
  relatedTrackCache = [];
  relatedTrackCursor = 0;
  isFetchingRelated = false;
  // Preserve the saved queue and current track while Live is active.
  window.onDemandPlaying = false;
  stopOnDemandSilentLoop();

  window.onDemandPlaybackActive = false;
  setOnDemandAudioReady(false);
  document.body.classList.remove('on-demand-paused');
  updateTransportButtonState();
  updateNowPlayingSubtitle(false);
  window.setOnDemandAudioQuality?.(false);
  document.body.classList.remove('on-demand-active');
  onDemandArtwork.hidden = false;
  onDemandArtwork.classList.remove('is-wide-thumbnail');
  onDemandMiniArtwork.classList.remove('is-wide-thumbnail');
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
window.startOnDemandQueue = startOnDemandQueue;
window.toggleOnDemandPlayback = toggleOnDemandPlayback;
window.skipOnDemandSong = skipOnDemandSong;
window.refreshOnDemandMediaSessionMetadata = refreshOnDemandMediaSessionMetadata;
window.updateOnDemandMediaSessionPositionState = updateOnDemandMediaSessionPositionState;
window.returnToLive = returnToLive;
// Legacy liked rows keep a `youtubeVideoId`; expose it so their rating key
// stays `youtube:ID` while such a row is playing. JioSaavn picks have none.
window.getCurrentOnDemandSong = () => currentOnDemandSong
  ? { ...currentOnDemandSong, youtubeVideoId: currentOnDemandSong.youtubeVideoId || '' }
  : null;
window.getOnDemandHistory = () => onDemandRecentHistory
  .map((song) => ({ ...song }));
window.getOnDemandPlaybackHistory = () => onDemandPlaybackHistory
  .map((song) => ({ ...song }));
window.getOnDemandQueuePosition = () => ({
  queueSessionId: onDemandQueueSessionId,
  queueStep: Math.max(0, onDemandQueueIndex - onDemandQueueStartIndex)
});
window.recordOnDemandLikedRecent = (song) => {
  if (song?.trackName) rememberOnDemandSong(song, { fromLikedFolder: true });
};

/* Mute/unmute the on-demand audio element. */
window.setOnDemandMuted = (muted) => {
  try {
    onDemandAudio.muted = Boolean(muted);
    if (handoffOutgoingAudio) handoffOutgoingAudio.muted = Boolean(muted);
  } catch (_) { /* element not controllable yet */ }
};

/* Set the on-demand player's volume LEVEL (0-100). */
window.setOnDemandVolume = (level) => {
  try {
    onDemandAudio.volume = Math.max(0, Math.min(100, Math.round(Number(level) || 0))) / 100;
    if (handoffOutgoingAudio) {
      handoffOutgoingAudio.volume = onDemandAudio.volume;
      handoffVolume = onDemandAudio.volume;
    }
  } catch (_) { /* element not controllable yet */ }
};

if (onDemandArtwork) {
  onDemandArtwork.setAttribute('role', 'button');
  onDemandArtwork.tabIndex = 0;
  onDemandArtwork.setAttribute('aria-label', 'Find and play this song on demand');
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
  const hasSource = Boolean(onDemandAudio.getAttribute('src'));
  const mediaDuration = Number(onDemandAudio.duration);
  return {
    elapsed: hasSource ? onDemandAudio.currentTime || 0 : 0,
    duration: hasSource && Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : selectedDuration
  };
};

returnToLiveButton.addEventListener('click', returnToLive);
liveModeButton?.addEventListener('click', () => {
  if (window.onDemandPlaybackActive) returnToLive();
});
onDemandModeButton?.addEventListener('click', () => {
  if (window.onDemandPlaybackActive) return;
  if (onDemandModeButton.disabled) return;
  if (readOnDemandSession()) {
    void restoreOnDemandSession();
    return;
  }
  onDemandArtwork?.click();
});

const desktopNowPlayingTab = document.querySelector('.desktop-nav-links [data-view="now-playing"]');

function hasOnDemandInMemory() {
  return Boolean(currentOnDemandSong?.trackName || readOnDemandSession());
}

const syncDesktopNowPlayingTab = () => {
  const enabled = hasOnDemandInMemory();
  if (desktopNowPlayingTab) {
    desktopNowPlayingTab.disabled = !enabled;
    desktopNowPlayingTab.classList.toggle('is-disabled', !enabled);
    desktopNowPlayingTab.setAttribute('aria-disabled', String(!enabled));
    if (!enabled) desktopNowPlayingTab.removeAttribute('aria-current');
  }
};

const syncModeToggle = () => {
  const onDemand = Boolean(window.onDemandPlaybackActive);
  const session = readOnDemandSession();
  const hasLiveQueue = onDemandQueue.length > 0 &&
    onDemandQueueIndex >= 0 && onDemandQueueIndex < onDemandQueue.length;
  const savedQueue = Array.isArray(session?.queue) ? session.queue : [];
  const hasSavedQueue = savedQueue.length > 0 &&
    Number.isInteger(session?.queueIndex) &&
    session.queueIndex >= 0 && session.queueIndex < savedQueue.length;
  const hasOnDemandData = Boolean(
    (onDemand && currentOnDemandSong?.trackName && hasLiveQueue) ||
    (!onDemand && hasSavedQueue)
  );
  playerModeToggle?.classList.toggle('is-on-demand', onDemand);
  liveModeButton?.setAttribute('aria-pressed', String(!onDemand));
  onDemandModeButton?.setAttribute('aria-pressed', String(onDemand));
  if (onDemandModeButton) {
    onDemandModeButton.disabled = !onDemand && !hasOnDemandData;
    onDemandModeButton.setAttribute('aria-disabled', String(onDemandModeButton.disabled));
  }
  syncDesktopNowPlayingTab();
};
syncModeToggle();
syncDesktopNowPlayingTab();
window.addEventListener('thaalam:nowplaying', syncModeToggle);
new MutationObserver(syncModeToggle).observe(document.body, {
  attributes: true,
  attributeFilter: ['class']
});
let lastPositionSaveAt = 0;
window.setInterval(() => {
  updatePlaybackProgress();
  if (window.onDemandPlaybackActive && Date.now() - lastPositionSaveAt >= 3000) {
    lastPositionSaveAt = Date.now();
    persistCurrentOnDemandSession();
  }
}, 500);
window.addEventListener('pagehide', () => {
  if (isMobilePlaybackLayout() && window.onDemandPlaybackActive) {
    mobilePlaybackWasActiveBeforeHide ||= window.onDemandPlaying === true;
    // pagehide can mean the PWA was backgrounded for the lock screen, not that
    // playback was stopped. Preserve a queued track's pending play() intent;
    // refresh/reopen still restores mobile sessions paused via shouldResume.
    // Persist a paused restore state for refresh/reopen, but don't pause the
    // live audio element here: mobile browsers can emit pagehide while
    // backgrounding a PWA, and the stream should continue when allowed.
    const wasPlaying = window.onDemandPlaying === true;
    window.onDemandPlaying = false;
    persistCurrentOnDemandSession();
    window.onDemandPlaying = wasPlaying;
    return;
  }
  persistCurrentOnDemandSession();
});

/* On-demand survives a refresh, so it is restored on load. This runs on
   DOMContentLoaded (rather than inline) so the live-radio startup in script.js
   has finished wiring itself up before on-demand takes over the UI. */
if (document.readyState === 'loading') {
  logOnDemand('readyState=loading, waiting for DOMContentLoaded to restore');
  document.addEventListener('DOMContentLoaded', () => {
    if (readPlaybackMode() === 'live') {
      logOnDemand('DOMContentLoaded fired -> keeping Live mode');
      return;
    }
    logOnDemand('DOMContentLoaded fired -> restoring On-Demand mode');
    void restoreOnDemandSession();
  });
} else {
  if (readPlaybackMode() !== 'live') void restoreOnDemandSession();
}
