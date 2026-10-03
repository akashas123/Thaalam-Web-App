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
let selectedDuration = 0;
let songRequestId = 0;
let videoCandidates = [];
let videoCandidateIndex = 0;

/* Every on-demand song played this session, in order. The previous/next
   buttons walk this list; the live feed is not part of it. */
let onDemandQueue = [];
let onDemandQueueIndex = -1;
let isScrubbing = false;
let scrubTargetSeconds = 0;

/* Similar-songs list for the track that is currently playing, fetched as soon
   as a track starts so the next one is ready the moment this one ends. */
let relatedTrackCache = [];
let relatedTrackCursor = 0;
let isFetchingRelated = false;
let prefetchToken = 0;
let autoplayRetryTimer = 0;

/* VideoIds already played this session, so a radio playlist that circles back
   to an earlier track does not replay it. */
const playedVideoIds = new Set();

/* On-demand is a mode, not a momentary action: it has to outlive a refresh and
   closing the tab, so the current track is written to storage as it plays and
   replayed on the next load. Only the "Back to Live" button clears it. */
const ON_DEMAND_STORAGE_KEY = 'thaalam-on-demand-session-v1';
const YOUTUBE_SEARCH_CACHE_PREFIX = 'thaalam-youtube-search-v9:';
const YOUTUBE_SEARCH_CACHE_TTL = 6 * 60 * 60 * 1000;
const NON_YOUTUBE_MUSIC_TITLE = /\b(?:official\s+)?music\s+video\b|\b(?:official\s+)?video\b|\bvisuali[sz]er\b|\blyrics?\b|\blive\b|\bkaraoke\b|\bcover\b|\bperformance\b|\breaction\b/i;
const UNOFFICIAL_MIX_TITLE = /\b(?:unofficial|remix(?:es)?|mix(?:es)?|mash[ -]?up|medley|compilation|playlist|slowed(?:\s+\+?\s+reverb)?|sped\s*up|nightcore|bootleg|fan[ -]?made|edit|1\s*hour|extended)\b/i;

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
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
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
      throw new Error('YouTube search backend is missing. Include _worker.js in the Cloudflare Pages upload, or deploy the Pages Function through Git integration or Wrangler.');
    }
    throw new Error(`YouTube search returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) {
    const apiError = typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message;
    throw new Error(apiError || `YouTube search failed (${response.status}).`);
  }

  const items = payload.results || [];

  setYouTubeSearchCache(cacheKey, items);
  return items;
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
      const lowQualityMatch = NON_YOUTUBE_MUSIC_TITLE.test(item.title);
      return {
        ...item,
        score: (exactTitle ? 100 : titleMatch ? 65 : 0) +
          (artistMatch ? 30 : 0) + (featuredArtistMatch ? 8 : 0) +
          (albumFirst && albumMatch ? 24 : albumMatch ? 12 : 0) +
          Math.max(0, 20 - index) - (lowQualityMatch ? 40 : 0)
      };
    }).filter((item) => item.videoId)
      .sort((a, b) => b.score - a.score);

  // Search the named album first, then retry with exact-title variants. Keep
  // the best Songs-filtered result across all queries instead of failing just
  // because YouTube formats a title or featured-artist credit differently.
  const queries = [
    album && { query: `${title} ${artist} ${album}`, albumFirst: true },
    { query: `${title} ${artist}`, albumFirst: false },
    { query: `${normalizeYouTubeSongTitle(title)} ${artist}`, albumFirst: false }
  ].filter((entry) => entry?.query.trim());
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
  if (!best) throw new Error('YouTube Music found no playable song for this search.');
  return { ...best, alternatives: ranked.slice(1).map((item) => item.videoId) };
}

function saveOnDemandSession(song, videoId) {
  try {
    const payload = JSON.stringify({
      song,
      videoId,
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

function setCurrentOnDemandTrack(song, videoId) {
  currentOnDemandSong = song;
  currentOnDemandVideoId = videoId || '';
}

function persistCurrentOnDemandSession() {
  if (!currentOnDemandSong?.trackName || !currentOnDemandVideoId) return;
  saveOnDemandSession(currentOnDemandSong, currentOnDemandVideoId);
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
      reject(new Error('YouTube player timed out loading.'));
    }, 12000);

    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    script.onerror = () => {
      window.clearTimeout(timeoutId);
      youtubeApiPromise = null;
      reject(new Error('YouTube player failed to load.'));
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
function getScrubSecondsFromPointer(clientX) {
  if (!playbackProgressBar || !youtubePlayerReady) return null;

  const rect = playbackProgressBar.getBoundingClientRect();
  if (!rect.width) return null;

  const duration = youtubePlayer.getDuration() || selectedDuration;
  if (!(duration > 0)) return null;

  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * duration;
}

function commitScrub() {
  if (!isScrubbing || !youtubePlayerReady) return;
  isScrubbing = false;
  playbackProgressBar?.classList.remove('is-scrubbing');

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

if (playbackProgressBar) {
  playbackProgressBar.addEventListener('pointerdown', (event) => {
    if (!window.onDemandPlaybackActive || !youtubePlayerReady) return;

    const seconds = getScrubSecondsFromPointer(event.clientX);
    if (seconds === null) return;

    isScrubbing = true;
    scrubTargetSeconds = seconds;
    playbackProgressBar.classList.add('is-scrubbing');
    playbackProgressBar.setPointerCapture?.(event.pointerId);
    updatePlaybackProgress();
  });

  playbackProgressBar.addEventListener('pointermove', (event) => {
    if (!isScrubbing) return;

    const seconds = getScrubSecondsFromPointer(event.clientX);
    if (seconds === null) return;

    scrubTargetSeconds = seconds;
    updatePlaybackProgress();
  });

  playbackProgressBar.addEventListener('pointerup', commitScrub);
  playbackProgressBar.addEventListener('pointercancel', commitScrub);
}

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
    setOnDemandPlaying(true);
  } else if (event.data === states.BUFFERING) {
    onDemandModeLabel.textContent = 'BUFFERING';
    onDemandPlayButton?.classList.add('is-loading');
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

function handleYouTubeError(event) {
  logOnDemand('player ERROR code =', event?.data,
    '(active =', window.onDemandPlaybackActive,
    ', candidates =', videoCandidates.length, ')');
  if (!window.onDemandPlaybackActive) return;
  if (videoCandidateIndex + 1 < videoCandidates.length) {
    videoCandidateIndex += 1;
    onDemandModeLabel.textContent = 'TRYING ANOTHER RESULT';
    event.target.loadVideoById(videoCandidates[videoCandidateIndex]);
    return;
  }
  console.error('YouTube rejected every matching video:', event.data);
  onDemandMount.hidden = true;
  onDemandArtwork.hidden = false;
  onDemandArtwork.style.opacity = '1';
  onDemandPlayButton.disabled = true;
  onDemandMiniToggle.disabled = true;
  onDemandModeLabel.textContent = 'UNAVAILABLE';
  onDemandStation.textContent = 'YouTube playback unavailable';
  setOnDemandPlaying(false);
  returnToLiveButton.hidden = false;
}

async function loadVideo(videoId, requestId) {
  requestedVideoId = videoId;
  await loadYouTubeApi();
  if (requestId !== songRequestId || !window.onDemandPlaybackActive) return;
  onDemandMount.hidden = false;
  // Keep the album artwork visible on top of the YouTube iframe so the
  // embedded video player stays masked while its audio keeps playing.
  onDemandArtwork.hidden = false;
  onDemandArtwork.style.opacity = '1';

  if (youtubePlayerReady) {
    youtubePlayer.loadVideoById(videoId);
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
            autoplay: 1,
            controls: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0
          },
          events: {
            onReady(event) {
              youtubePlayerReady = true;
              if (!window.onDemandPlaybackActive) {
                event.target.pauseVideo();
                resolve(event.target);
                return;
              }
              if (requestedVideoId !== initialVideoId) {
                event.target.loadVideoById(requestedVideoId);
              } else {
                event.target.playVideo();
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
  const title = song.trackName || video.title || 'Unknown song';
  const artist = (song.artistName || video.artist || 'Unknown artist')
    .replace(/\s-\sTopic$/i, '')
    .trim();
  const album = song.collectionName || '';
  const artwork = song.artworkUrl100
    ?.replace(/^http:/, 'https:')
    .replace(/\d+x\d+bb\./, '600x600bb.') || '';
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
  if (artwork) {
    onDemandArtwork.src = artwork;
    onDemandMiniArtwork.src = artwork;
    // Match the live-radio UX: tint the page gradient from the album art.
    const colorRequestId = window.bumpArtworkRequestId?.() ?? 0;
    window.updateAlbumColors?.(artwork, colorRequestId);
  }
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
  startOnDemandSong(nextSong);
}

onDemandPrevButton?.addEventListener('click', () => skipOnDemandSong(-1));
onDemandNextButton?.addEventListener('click', () => skipOnDemandSong(1));

/* Fetches embeddable tracks from YouTube search. Returns [] rather than
   throwing so an unavailable search simply leaves the player stopped. */
async function fetchRelatedTracks(videoId, song) {
  if (!videoId && !song?.artistName) return [];
  try {
    const artist = String(song?.artistName || '').replace(/\s-\sTopic$/i, '');
    // iTunes labels many unrelated South Asian languages simply as "Indian".
    // Seed with this exact song and artist so YouTube Music can find closer
    // language/style matches without broadening autoplay to the whole region.
    const relatedQuery = [song?.trackName, artist, 'similar songs official audio']
      .filter(Boolean).join(' ');
    const tracks = await searchYouTubeVideos(relatedQuery, 25);
    return tracks
      .filter((track) =>
        track.videoId !== videoId &&
        !playedVideoIds.has(track.videoId) &&
        !NON_YOUTUBE_MUSIC_TITLE.test(track.title) &&
        !UNOFFICIAL_MIX_TITLE.test(track.title)
      )
      .map((track) => ({
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        thumbnail: track.thumbnail,
        primaryGenreName: song?.primaryGenreName || '',
        duration: ''
      }));
  } catch (error) {
    console.warn('Autoplay: YouTube related search failed.', error);
    return [];
  }
}

/* Kicks off a background lookup for the track that just started, so the queue
   of similar songs is already populated by the time it finishes playing. */
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
    artworkUrl100: track.artworkUrl100 || track.thumbnail || '',
    trackTimeMillis: (parseVideoDuration(track.duration) || 0) * 1000
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

/* Called when a track ends. Plays the next prefetched similar song straight
   away, with no waiting on the network. */
function advanceToSimilarSong() {
  if (!window.onDemandPlaybackActive) return;

  const nextTrack = relatedTrackCache[relatedTrackCursor];
  if (nextTrack) {
    relatedTrackCursor += 1;
    playRelatedTrack(nextTrack);
    return;
  }

  // The prefetch has not landed yet (or returned nothing). Retry briefly rather
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
    if (attempts > 20 || (!isFetchingRelated && attempts > 4)) {
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

  isScrubbing = false;
  scrubTargetSeconds = 0;
  playbackProgressBar?.classList.remove('is-scrubbing');

  // A related track may be a poor match for the iframe, so keep the same
  // candidate fallback the search path uses.
  videoCandidates = [track.videoId];
  videoCandidateIndex = 0;

  // Record the track before it loads, so a refresh mid-load still restores.
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
  // Chain: start pulling similar songs for this track straight away, so the
  // list is ready long before this one finishes.
  playedVideoIds.add(track.videoId);
  prefetchRelatedTracks(track.videoId, song);
}

async function startOnDemandSong(song) {
  if (!song?.trackName) return;
  const requestId = ++songRequestId;
  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  enqueueOnDemandSong(song);
  updateTransportButtonState();
  isScrubbing = false;
  scrubTargetSeconds = 0;
  playbackProgressBar?.classList.remove('is-scrubbing');
  window.onDemandPlaybackActive = true;
  document.body.classList.add('on-demand-active');
  window.pauseLiveStreamForOnDemand?.();
  returnToLiveButton.hidden = false;
  onDemandModeLabel.textContent = 'LOADING';
  onDemandStation.textContent = 'Finding track';
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;
  onDemandPlayButton?.classList.add('is-loading');

  try {
    await window.showView?.('now-playing');
    if (requestId !== songRequestId) return;

    const video = await findYouTubeSong(song);
    if (requestId !== songRequestId) return;

    videoCandidates = [...new Set([video.videoId, ...(video.alternatives || [])])];
    videoCandidateIndex = 0;
    selectedDuration = parseVideoDuration(video.duration) || selectedDuration;
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
      ? 'YouTube Music search could not be reached. Check your connection.'
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

/* Re-enters on-demand playback after a refresh or a reopened tab.

   The live feed is deliberately not restarted first: the point is that the app
   comes back exactly as the listener left it, so the stored videoId is loaded
   directly and the search round-trip is skipped. */
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
  // Enter the same on-demand state a fresh selection would, before any live
  // data arrives, so the radio cannot paint over the restored song.
  window.onDemandPlaybackActive = true;
  document.body.classList.add('on-demand-active');
  window.pauseLiveStreamForOnDemand?.();
  returnToLiveButton.hidden = false;
  onDemandModeLabel.textContent = 'LOADING';
  onDemandStation.textContent = 'Resuming on demand';
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;

  const requestId = ++songRequestId;
  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  enqueueOnDemandSong(song);
  updateTransportButtonState();
  setCurrentOnDemandTrack(song, stored.videoId);

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
    await loadVideo(stored.videoId, requestId);
    logOnDemand('loadVideo() resolved; playerReady =', youtubePlayerReady,
      'state =', youtubePlayerReady ? youtubePlayer.getPlayerState() : 'n/a');
    if (requestId !== songRequestId || !window.onDemandPlaybackActive) {
      logOnDemand('ABORT after loadVideo: superseded or no longer on-demand');
      return;
    }

    updatePlaybackProgress();
    playedVideoIds.add(stored.videoId);
    prefetchRelatedTracks(stored.videoId, song);
    // Honour the pause state the session was closed with.
    if (stored.playing === false) toggleOnDemandPlayback(false);
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
  isScrubbing = false;
  scrubTargetSeconds = 0;
  playbackProgressBar?.classList.remove('is-scrubbing');
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
  document.body.classList.remove('on-demand-active');
  onDemandMount.hidden = true;
  onDemandArtwork.hidden = false;
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
window.setInterval(updatePlaybackProgress, 500);

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
