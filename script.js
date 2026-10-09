const HLS_STREAM_URL = 'https://radio.thaalam24x7.in/hls/thaalam_24x7/live.m3u8';
const NOW_PLAYING_API = 'https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7';
const SCHEDULE_API = 'https://radio.thaalam24x7.in/api/station/6/schedule';
const PLAYBACK_STARTED_KEY = 'thaalam-playback-started-v1';

const radio = document.getElementById('radio');
const playIcon = document.getElementById('playIcon');
const playButton = document.getElementById('playButton');
const nowPlayingEl = document.getElementById('nowPlaying');
const stationNameEl = document.getElementById('stationName');
const albumArtImage = document.getElementById('albumArtImg');
const miniPlayer = document.getElementById('miniPlayer');
const miniPlayerArt = document.getElementById('miniPlayerArt');
const miniPlayerTitle = document.getElementById('miniPlayerTitle');
const miniPlayerArtist = document.getElementById('miniPlayerArtist');
const miniPlayerElapsed = document.getElementById('miniPlayerElapsed');
const miniPlayerDuration = document.getElementById('miniPlayerDuration');
const miniPlayerToggle = document.getElementById('miniPlayerToggle');
const miniPlayerIcon = document.getElementById('miniPlayerIcon');
const miniPlayerProgress = document.getElementById('miniPlayerProgress');
const miniPlayerProgressFill = document.getElementById('miniPlayerProgressFill');
const miniPrevButton = document.getElementById('miniPrevButton');
const miniNextButton = document.getElementById('miniNextButton');
const miniLikeButton = document.getElementById('miniLikeButton');
const miniInfoButton = document.getElementById('miniInfoButton');
const miniVolumeButton = document.getElementById('miniVolumeButton');
const miniVolumeSlider = document.getElementById('miniVolumeSlider');
const miniVolumeValue = document.getElementById('miniVolumeValue');
const root = document.documentElement;

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

document.addEventListener('copy', (event) => {
  event.preventDefault();
});

document.addEventListener('cut', (event) => {
  event.preventDefault();
});

document.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

document.addEventListener('selectstart', (event) => {
  event.preventDefault();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('button')) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

let lastSongText = '';
let lastArtwork = '';
let lastStationLabel = 'Thaalam 24x7';
let artworkRequestId = 0;
let nowPlayingRequestId = 0;
let scheduleRequestId = 0;
let isConnecting = false;
let isStreamOffline = false;
let shouldResumePlayback = false;
let liveDataPaused = false;
let audioIsAdvancing = false;
let hasStartedPlayback = (() => {
  try {
    return localStorage.getItem(PLAYBACK_STARTED_KEY) === 'true';
  } catch {
    return false;
  }
})();
let streamStallTimer = 0;
let hlsPlayer = null;
const streamQuality = document.getElementById('streamQuality');
let lastStreamQuality = 'AUTO';
window.hlsPlaybackSessionId = window.hlsPlaybackSessionId || 0;
window.awaitingFreshHlsPosition = false;

function setAlbumColors(colors) {
  if (!colors || colors.length < 5) return;
  ['--c1', '--c2', '--c3', '--c4', '--c5'].forEach((property, index) => {
    root.style.setProperty(property, colors[index]);
  });

  const palette = colors.slice(0, 5).map((color) => {
    const hex = color.replace('#', '');
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  });
  const average = [0, 1, 2].map((channel) =>
    palette.reduce((total, color) => total + color[channel], 0) / palette.length
  );
  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute('content', rgbToHex(...average.map((channel) => channel * 0.34)));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value)))
      .toString(16).padStart(2, '0'))
    .join('')}`;
}

function colorDistance(first, second) {
  const red = first.r - second.r;
  const green = first.g - second.g;
  const blue = first.b - second.b;
  return Math.sqrt(red * red + green * green + blue * blue);
}

function extractAlbumColors(image) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const size = 80;
  canvas.width = size;
  canvas.height = size;

  try {
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    const candidates = [];

    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha < 180) continue;

      const brightness = (red + green + blue) / 3;
      if (brightness < 12 || brightness > 248) continue;

      candidates.push({
        r: red,
        g: green,
        b: blue,
        saturation: Math.max(red, green, blue) - Math.min(red, green, blue),
        brightness
      });
    }

    candidates.sort((first, second) =>
      second.saturation + second.brightness * 0.35 -
      (first.saturation + first.brightness * 0.35));

    const selected = [];
    for (const candidate of candidates) {
      if (!selected.some((color) => colorDistance(candidate, color) < 55)) {
        selected.push(candidate);
      }
      if (selected.length >= 5) break;
    }

    while (selected.length < 5) {
      selected.push({ r: 8, g: 12, b: 20, brightness: 12 });
    }

    setAlbumColors(selected.map((color) => {
      const multiplier = color.brightness < 80 ? 1.25 : 0.72;
      return rgbToHex(
        color.r * multiplier,
        color.g * multiplier,
        color.b * multiplier
      );
    }));
  } catch (error) {
    console.log('Album color extraction failed:', error);
  }
}

function updateAlbumColors(imageUrl, requestId) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (requestId === artworkRequestId) {
      extractAlbumColors(image);
    }
  };
  image.onerror = () => console.log('Album artwork could not be loaded for color extraction');
  image.src = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}color=${Date.now()}`;
}

// Let other modules (e.g. on-demand playback) reuse the same gradient extraction.
window.updateAlbumColors = updateAlbumColors;
window.bumpArtworkRequestId = () => ++artworkRequestId;

function setVisualState(isPlaying) {
  const tagline = document.querySelector('.tagline');
  if (isPlaying && !hasStartedPlayback) {
    hasStartedPlayback = true;
    try {
      localStorage.setItem(PLAYBACK_STARTED_KEY, 'true');
    } catch {
    }
  }

  document.body.classList.toggle('mini-player-visible', hasStartedPlayback);
  miniPlayer?.classList.toggle('is-playing', isPlaying);
  if (miniPlayer) miniPlayer.hidden = !hasStartedPlayback;
  miniPlayerToggle?.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  if (isPlaying) showPauseIcon();
  else showPlayIcon();

  if (!tagline) return;

  if (isPlaying) {
    tagline.classList.remove('paused');
    document.body.classList.remove('paused-gradient');
  } else {
    tagline.classList.add('paused');
    document.body.classList.add('paused-gradient');
  }
}

function showPlayIcon() {
  if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  if (miniPlayerIcon) miniPlayerIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
}

function showPauseIcon() {
  if (playIcon) playIcon.innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
  if (miniPlayerIcon) miniPlayerIcon.innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
}

function setStreamLoading(isLoading) {
  // On-demand owns the shared buttons' spinner while it is active; live-state
  // events (e.g. the teardown <audio> element pausing) must not strip it.
  if (window.onDemandPlaybackActive) return;
  playButton?.classList.toggle('is-loading', isLoading);
  miniPlayerToggle?.classList.toggle('is-loading', isLoading);
  playButton?.setAttribute(
    'aria-label',
    isLoading ? 'Reconnecting to stream' : radio?.paused ? 'Play' : 'Pause'
  );
}

function formatMiniTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

/* Last live clock reading, used to freeze the mini timer while paused. */
let lastLiveClockValue = 0;

function updateMiniPlayerTime() {
  if (!miniPlayerElapsed || !miniPlayerDuration) return;
  const onDemandClock = window.onDemandPlaybackActive
    ? window.getOnDemandTrackClock?.()
    : null;
  if (onDemandClock) {
    // Follow an in-progress scrub instead of the player's real position.
    const scrubSeconds = window.getDemandScrubSeconds?.();
    const elapsed = Number.isFinite(scrubSeconds)
      ? scrubSeconds
      : onDemandClock.elapsed;
    miniPlayerElapsed.textContent = formatMiniTime(elapsed);
    miniPlayerDuration.textContent = formatMiniTime(onDemandClock.duration);
    updateMiniPlayerProgress(elapsed, onDemandClock.duration);
    return;
  }
  const clock = window.getAudibleTrackClock?.();
  if (clock) {
    // Freeze the mini timer/fill at the last audible reading while the stream
    // is paused. On resume, lyrics.js holds the clock until the fresh
    // now-playing snapshot re-syncs it to the live playback position.
    const paused = Boolean(radio?.paused);
    const elapsed = paused ? lastLiveClockValue : clock.elapsed;
    if (!paused) lastLiveClockValue = elapsed;
    miniPlayerElapsed.textContent = formatMiniTime(elapsed);
    miniPlayerDuration.textContent = formatMiniTime(clock.duration);
    updateMiniPlayerProgress(elapsed, clock.duration);
    return;
  }
  miniPlayerElapsed.textContent = document.getElementById('trackElapsed')?.textContent || '0:00';
  miniPlayerDuration.textContent = document.getElementById('trackDuration')?.textContent || '0:00';
  updateMiniPlayerProgress(0, 0);
}

/* Paints the mini seek bar. When the track length is unknown it falls back to
   the static "live" indicator rather than a moving fill. */
function updateMiniPlayerProgress(elapsed, duration) {
  if (!miniPlayerProgress || !miniPlayerProgressFill) return;
  const safeDuration = Number(duration) || 0;
  const safeElapsed = Number(elapsed) || 0;
  if (safeDuration <= 0) {
    miniPlayerProgress.classList.add('is-live');
    miniPlayerProgressFill.style.width = '';
    miniPlayerProgress.setAttribute('aria-valuenow', '0');
    return;
  }
  miniPlayerProgress.classList.remove('is-live');
  const percent = Math.min(100, Math.max(0, (safeElapsed / safeDuration) * 100));
  miniPlayerProgressFill.style.width = `${percent}%`;
  miniPlayerProgress.setAttribute('aria-valuenow', String(Math.round(percent)));
}

/* The mini transport/action buttons reuse the full player's own controls so the
   two never drift. Clicking a mini button simply triggers its counterpart. */
function bindMiniPlayerProxy(miniButton, targetId) {
  if (!miniButton) return;
  miniButton.addEventListener('click', () => {
    const target = document.getElementById(targetId);
    if (target && !target.disabled) target.click();
  });
}

bindMiniPlayerProxy(miniPrevButton, 'onDemandPrevButton');
bindMiniPlayerProxy(miniNextButton, 'onDemandNextButton');
bindMiniPlayerProxy(miniInfoButton, 'songInfoButton');

/* "Like" maps to a different control per mode: the on-demand heart, or the
   live-radio thumbs-up. Pick the right one at click time. */
if (miniLikeButton) {
  miniLikeButton.addEventListener('click', () => {
    const target = window.onDemandPlaybackActive
      ? document.getElementById('onDemandLikeButton')
      : document.getElementById('thumbsUpButton');
    if (target && !target.disabled) target.click();
  });
}

/* Mirror the real controls' availability/selection onto the mini buttons so the
   docked player reflects live vs on-demand state without duplicating logic. */
function syncMiniPlayerControls() {
  const onDemandActive = Boolean(window.onDemandPlaybackActive);

  // The mini seek bar is only interactive for on-demand tracks.
  miniPlayerProgress?.classList.toggle('is-seekable', onDemandActive);
  const prevButton = document.getElementById('onDemandPrevButton');
  const nextButton = document.getElementById('onDemandNextButton');
  const likeButton = document.getElementById('onDemandLikeButton');
  const thumbsUp = document.getElementById('thumbsUpButton');

  if (miniPrevButton) miniPrevButton.disabled = !onDemandActive || Boolean(prevButton?.disabled);
  if (miniNextButton) miniNextButton.disabled = !onDemandActive || Boolean(nextButton?.disabled);

  // "Like" is pressed when either the on-demand heart or the live thumbs-up is.
  const liked = Boolean(
    likeButton?.classList.contains('rating-selected') ||
    thumbsUp?.classList.contains('rating-selected')
  );
  if (miniLikeButton) {
    miniLikeButton.classList.toggle('is-active', liked);
    miniLikeButton.setAttribute('aria-pressed', String(liked));
    miniLikeButton.setAttribute('aria-label', liked ? 'Unlike' : 'Like');
    miniLikeButton.title = liked ? 'Unlike' : 'Like';
  }

  if (miniInfoButton) {
    const info = document.getElementById('songInfoButton');
    miniInfoButton.disabled = Boolean(info?.disabled);
  }
}

window.syncMiniPlayerControls = syncMiniPlayerControls;
setInterval(syncMiniPlayerControls, 250);

/* Volume + mute. The app has two audio sources that both need to be controlled
   together: the live-radio <audio> element and the YouTube on-demand player.
   The slider (and mouse wheel over the control) set a persisted volume LEVEL
   (0-100); the speaker button is an independent MUTE toggle. Both are remembered
   so a reload or a radio reconnect keeps the listener's choices. */
const VOLUME_MUTED_KEY = 'thaalam-muted-v1';
const VOLUME_LEVEL_KEY = 'thaalam-volume-v1';
const DEFAULT_VOLUME = 100;
const VOLUME_WHEEL_STEP = 5;

let currentVolumeLevel = DEFAULT_VOLUME;

function isVolumeMuted() {
  try {
    return localStorage.getItem(VOLUME_MUTED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function getStoredVolume() {
  try {
    const value = Number(localStorage.getItem(VOLUME_LEVEL_KEY));
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  } catch (_) { /* fall through to default */ }
  return DEFAULT_VOLUME;
}

/* Reflect the current level + mute flag onto the speaker icon. The icon shows
   the "muted" state whenever the output is silent: either the explicit mute
   toggle is on, or the level has been dragged/wheeled all the way down to 0. */
function updateVolumeVisual() {
  if (!miniVolumeButton) return;
  const effectivelyMuted = isVolumeMuted() || currentVolumeLevel === 0;
  miniVolumeButton.classList.toggle('is-muted', effectivelyMuted);
  miniVolumeButton.setAttribute('aria-pressed', String(effectivelyMuted));
  miniVolumeButton.setAttribute('aria-label', effectivelyMuted ? 'Unmute' : 'Mute');
  miniVolumeButton.title = effectivelyMuted ? 'Unmute' : 'Mute';
  if (miniVolumeValue) miniVolumeValue.classList.toggle('is-muted', effectivelyMuted);
}

/* Push a 0-100 level to both audio sources and the slider, then refresh the
   icon so hitting zero flips it to the muted animation. The radio takes 0-1;
   the YouTube player takes 0-100 via the bridge exposed in youtube-player.js. */
function applyVolumeLevel(level, { persist = false } = {}) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  currentVolumeLevel = clamped;
  if (radio) radio.volume = clamped / 100;
  if (typeof window.setYouTubeVolume === 'function') window.setYouTubeVolume(clamped);
  if (miniVolumeSlider && Number(miniVolumeSlider.value) !== clamped) {
    miniVolumeSlider.value = String(clamped);
  }
  if (miniVolumeValue) miniVolumeValue.textContent = String(clamped);
  if (persist) {
    try { localStorage.setItem(VOLUME_LEVEL_KEY, String(clamped)); } catch (_) { /* ignore */ }
  }
  updateVolumeVisual();
  return clamped;
}

function applyMuteState(muted) {
  // Live radio element.
  if (radio) radio.muted = muted;
  // On-demand YouTube player (exposed by youtube-player.js).
  if (typeof window.setYouTubeMuted === 'function') window.setYouTubeMuted(muted);
  updateVolumeVisual();
}

if (miniVolumeButton) {
  miniVolumeButton.addEventListener('click', () => {
    const next = !isVolumeMuted();
    try {
      localStorage.setItem(VOLUME_MUTED_KEY, next ? '1' : '0');
    } catch (_) { /* storage may be unavailable; the toggle still works */ }
    applyMuteState(next);
  });
}

if (miniVolumeSlider) {
  miniVolumeSlider.addEventListener('input', () => {
    applyVolumeLevel(miniVolumeSlider.value, { persist: true });
  });
}

/* Mouse wheel over the volume control adjusts the level, like desktop players.
   Attached to both the speaker button and the slider so the whole control acts
   as one hover target. preventDefault keeps the page from scrolling underneath. */
function handleVolumeWheel(event) {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  applyVolumeLevel(currentVolumeLevel + direction * VOLUME_WHEEL_STEP, { persist: true });
}

if (miniVolumeButton) miniVolumeButton.addEventListener('wheel', handleVolumeWheel, { passive: false });
if (miniVolumeSlider) miniVolumeSlider.addEventListener('wheel', handleVolumeWheel, { passive: false });

// Restore the persisted choices as soon as the script runs, and keep the radio
// in sync if it reconnects later (a reload of the stream can clear these).
currentVolumeLevel = getStoredVolume();
applyVolumeLevel(currentVolumeLevel);
applyMuteState(isVolumeMuted());
if (radio) {
  radio.addEventListener('playing', () => {
    applyVolumeLevel(getStoredVolume());
    if (isVolumeMuted()) radio.muted = true;
  });
}

function updateMiniPlayerMarquees() {
  [miniPlayerTitle, miniPlayerArtist].forEach((element) => {
    if (!element) return;
    const text = element.textContent.trim();
    element.dataset.marqueeText = text;
    const isOverflowing = element.scrollWidth > element.clientWidth + 1;
    element.classList.toggle('is-marquee', isOverflowing);
    if (isOverflowing) {
      element.style.setProperty(
        '--mini-marquee-duration',
        `${Math.max(18, (element.scrollWidth + 150) / 24)}s`
      );
    }
  });
}

window.updateMiniPlayerMarquees = updateMiniPlayerMarquees;
window.updateMiniPlayerTime = updateMiniPlayerTime;
setInterval(updateMiniPlayerTime, 250);
window.addEventListener('resize', updateMiniPlayerMarquees);

function setStreamOffline(isOffline) {
  if (!streamQuality) return;

  isStreamOffline = isOffline;
  if (window.onDemandPlaybackActive) {
    streamQuality.classList.remove('is-offline');
    streamQuality.textContent = 'ADAPTIVE';
    streamQuality.setAttribute(
      'aria-label',
      'On-demand audio quality: adaptive (selected by YouTube; exact bitrate unavailable)'
    );
    return;
  }
  streamQuality.classList.toggle('is-offline', isOffline);

  if (isOffline) {
    streamQuality.textContent = 'OFFLINE';
    streamQuality.setAttribute('aria-label', 'Audio stream offline');
    return;
  }

  streamQuality.textContent = lastStreamQuality;
  streamQuality.setAttribute(
    'aria-label',
    `Current stream quality: ${lastStreamQuality.toLowerCase()}`
  );
}

function updateStreamQuality(levelIndex, levels = []) {
  if (!streamQuality || window.onDemandPlaybackActive) return;

  const sortedLevels = levels
    .map((level, index) => ({ index, bitrate: level.bitrate || level.averageBitrate || 0 }))
    .sort((first, second) => first.bitrate - second.bitrate);
  const activeLevel = sortedLevels.findIndex((level) => level.index === levelIndex);
  const tiers = ['LOW', 'MEDIUM', 'HIGH'];
  let label = 'AUTO';

  if (activeLevel >= 0 && sortedLevels.length === 1) {
    const bitrate = sortedLevels[0].bitrate;
    label = bitrate < 96000 ? 'LOW' : bitrate < 160000 ? 'MEDIUM' : 'HIGH';
  } else if (activeLevel >= 0) {
    label = tiers[Math.round(activeLevel * (tiers.length - 1) / (sortedLevels.length - 1))];
  }

  lastStreamQuality = label;
  if (isStreamOffline) return;
  streamQuality.setAttribute('aria-label', `Current stream quality: ${label.toLowerCase()}`);
  streamQuality.textContent = label;
}

window.setOnDemandAudioQuality = (isOnDemand) => {
  if (!streamQuality) return;

  if (isOnDemand) {
    streamQuality.classList.remove('is-offline');
    streamQuality.textContent = 'ADAPTIVE';
    streamQuality.setAttribute(
      'aria-label',
      'On-demand audio quality: adaptive (selected by YouTube; exact bitrate unavailable)'
    );
    return;
  }

  setStreamOffline(isStreamOffline);
};

async function startLiveStream() {
  if (isConnecting || !radio || window.onDemandPlaybackActive) return;
  liveDataPaused = false;
  isConnecting = true;
  shouldResumePlayback = true;
  setStreamLoading(true);
  if (!navigator.onLine) setStreamOffline(true);

  try {
    radio.pause();
    if (hlsPlayer) {
      hlsPlayer.destroy();
      hlsPlayer = null;
    }
    radio.removeAttribute('src');
    radio.load();

    if (window.Hls && window.Hls.isSupported()) {
      hlsPlayer = new window.Hls({
        maxBufferLength: 45,
        maxMaxBufferLength: 90
      });
      const player = hlsPlayer;
      await new Promise((resolve, reject) => {
        player.on(window.Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          updateStreamQuality(data.level, player.levels);
        });
        player.once(window.Hls.Events.MANIFEST_PARSED, () => {
          updateStreamQuality(player.currentLevel, player.levels);
          if (window.onDemandPlaybackActive) {
            resolve();
            return;
          }
          radio.play().then(resolve, reject);
        });
        player.on(window.Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            captureAudibleNowPlayingSnapshot();
            audioIsAdvancing = false;
            setVisualState(false);
            setStreamLoading(true);
            setStreamOffline(true);
            player.startLoad();
          } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            player.recoverMediaError();
          } else {
            reject(new Error(`Fatal HLS playback error: ${data.details}`));
          }
        });
        player.attachMedia(radio);
        player.loadSource(HLS_STREAM_URL);
      });
    } else if (radio.canPlayType('application/vnd.apple.mpegurl')) {
      radio.src = HLS_STREAM_URL;
      await radio.play();
    } else {
      throw new Error('This browser does not support HLS playback.');
    }

  } catch (error) {
    console.log('Unable to start live stream:', error);
    setVisualState(false);
    setStreamOffline(true);
    setStreamLoading(shouldResumePlayback);
  } finally {
    isConnecting = false;
  }
}

// Expose the measured distance from the HLS live edge so the UI can align
// server-side song timing with the audio the listener is hearing.
window.getAudioLiveLatencySeconds = () => {
  if (
    hlsPlayer &&
    Number.isFinite(hlsPlayer.latency) &&
    hlsPlayer.latency > 0
  ) {
    return hlsPlayer.latency;
  }

  if (radio?.seekable?.length) {
    const lastRange = radio.seekable.length - 1;
    const latency = radio.seekable.end(lastRange) - radio.currentTime;
    if (Number.isFinite(latency)) return Math.max(0, latency);
  }

  return 0;
};

function alignNowPlayingToAudio(data) {
  const nowPlaying = data?.now_playing;
  const currentSong = nowPlaying?.song;
  if (!nowPlaying || !currentSong) return data;

  const pausedSnapshot = window.lastAudibleNowPlayingData?.now_playing;
  if (!audioIsAdvancing && pausedSnapshot?.song) {
    return {
      ...data,
      now_playing: {
        ...nowPlaying,
        ...pausedSnapshot,
        song: pausedSnapshot.song
      }
    };
  }

  const elapsed = Number(nowPlaying.elapsed);
  const playedAt = Number(nowPlaying.played_at);
  const snapshotAge = Number.isFinite(window.rawNowPlayingReceivedAt)
    ? Math.max(0, performance.now() / 1000 - window.rawNowPlayingReceivedAt)
    : 0;
  const delay = !audioIsAdvancing
    ? 0
    : Number(window.getAudioLiveLatencySeconds?.()) || 0;

  if (
    !Number.isFinite(elapsed) ||
    !Number.isFinite(playedAt) ||
    playedAt <= 0
  ) {
    return {
      ...data,
      now_playing: {
        ...nowPlaying,
        elapsed: Number.isFinite(elapsed)
          ? Math.max(0, elapsed + snapshotAge - delay)
          : elapsed
      }
    };
  }

  const audibleTimestamp = playedAt + elapsed + snapshotAge - delay;
  const candidates = [nowPlaying, ...(data.song_history || [])]
    .filter((entry) => entry?.song && Number.isFinite(Number(entry.played_at)))
    .sort((first, second) => Number(second.played_at) - Number(first.played_at));

  const audibleEntry = candidates.find((entry) => {
    const start = Number(entry.played_at);
    const duration = Number(entry.duration);
    return audibleTimestamp >= start &&
      (!Number.isFinite(duration) || duration <= 0 || audibleTimestamp < start + duration);
  }) || candidates.find((entry) => Number(entry.played_at) <= audibleTimestamp) ||
    candidates[candidates.length - 1] || nowPlaying;

  const audibleStart = Number(audibleEntry.played_at);
  const audibleDuration = Number(audibleEntry.duration);
  const audibleElapsed = Math.max(0, audibleTimestamp - audibleStart);

  return {
    ...data,
    now_playing: {
      ...nowPlaying,
      song: audibleEntry.song,
      played_at: audibleEntry.played_at,
      duration: Number.isFinite(audibleDuration) && audibleDuration > 0
        ? audibleDuration
        : nowPlaying.duration,
      // Live songs can overrun their nominal length; keep the true audible
      // elapsed so readouts are not clamped to the total duration.
      elapsed: audibleElapsed,
      remaining: Number.isFinite(audibleDuration) && audibleDuration > 0
        ? Math.max(0, audibleDuration - audibleElapsed)
        : nowPlaying.remaining
    }
  };
}

function captureAudibleNowPlayingSnapshot() {
  const data = window.latestNowPlayingData;
  const nowPlaying = data?.now_playing;
  const song = nowPlaying?.song;
  const clock = window.getAudibleTrackClock?.();
  if (!song || !clock?.songId || !Number.isFinite(clock.elapsed)) return;

  const songId = song.id || [song.artist, song.title].filter(Boolean).join(' - ');
  if (songId !== clock.songId) return;

  const duration = clock.duration || Number(nowPlaying.duration) || 0;
  // No clamp to duration: live songs can overrun, and the snapshot must keep
  // the true audible elapsed for the frozen readout while paused.
  const elapsed = clock.elapsed;

  window.lastAudibleNowPlayingData = {
    ...data,
    now_playing: {
      ...nowPlaying,
      elapsed,
      remaining: duration > 0 ? Math.max(0, duration - elapsed) : nowPlaying.remaining
    }
  };
}

function togglePlay() {
  if (window.onDemandPlaybackActive) {
    window.toggleOnDemandPlayback?.();
    return;
  }
  if (!radio) return;
  if (radio.paused) {
    shouldResumePlayback = true;
    liveDataPaused = false;
    refreshStationAndTrackInfo();
    startLiveStream();
  } else {
    shouldResumePlayback = false;
    pauseLiveData();
    window.clearTimeout(streamStallTimer);
    setStreamLoading(false);
    setStreamOffline(false);
    audioIsAdvancing = false;
    setVisualState(false);
    showPlayIcon();
    stopLiveStreamTransport();
  }
}

function pauseLiveData() {
  liveDataPaused = true;
  nowPlayingRequestId += 1;
  scheduleRequestId += 1;
}

function stopLiveStreamTransport() {
  radio?.pause();
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  if (radio) {
    radio.removeAttribute('src');
    radio.load();
  }
}

window.pauseLiveStreamForOnDemand = () => {
  shouldResumePlayback = false;
  pauseLiveData();
  window.clearTimeout(streamStallTimer);
  setStreamLoading(false);
  setStreamOffline(false);
  // A paused media element can keep its HLS loader and buffered playlist
  // requests alive. Tear down the live source entirely while OnDemand owns
  // playback; startLiveStream() recreates it when the listener returns live.
  stopLiveStreamTransport();
};

window.setPlayerVisualState = setVisualState;
window.showPlayerPlayIcon = showPlayIcon;
window.showPlayerPauseIcon = showPauseIcon;
window.togglePlay = togglePlay;

if (radio) {
  const markStreamStalled = () => {
    if (radio.paused) return;
    captureAudibleNowPlayingSnapshot();
    audioIsAdvancing = false;
    setVisualState(false);
    setStreamLoading(true);
    window.clearTimeout(streamStallTimer);
    streamStallTimer = window.setTimeout(() => {
      setStreamOffline(true);
    }, 12000);
  };

  radio.addEventListener('waiting', markStreamStalled);
  radio.addEventListener('stalled', markStreamStalled);
  radio.addEventListener('error', () => {
    if (!shouldResumePlayback) return;
    captureAudibleNowPlayingSnapshot();
    audioIsAdvancing = false;
    setVisualState(false);
    setStreamLoading(true);
    setStreamOffline(true);
  });
  radio.addEventListener('playing', () => {
    if (window.onDemandPlaybackActive) {
      radio.pause();
      return;
    }
    const wasAdvancing = audioIsAdvancing;
    audioIsAdvancing = true;
    window.clearTimeout(streamStallTimer);
    setStreamOffline(false);
    setStreamLoading(false);
    setVisualState(true);
    showPauseIcon();
    if (!wasAdvancing) {
      window.hlsPlaybackSessionId += 1;
      window.awaitingFreshHlsPosition = true;
      updateNowPlaying();
    }
  });
  radio.addEventListener('pause', () => {
    audioIsAdvancing = false;
    if (!isConnecting) {
      captureAudibleNowPlayingSnapshot();
      shouldResumePlayback = false;
      window.clearTimeout(streamStallTimer);
      setStreamLoading(false);
      setStreamOffline(false);
    }
    if (window.onDemandPlaybackActive) return;
    setVisualState(false);
    showPlayIcon();
  });
}

window.addEventListener('offline', () => {
  if (!shouldResumePlayback) return;
  captureAudibleNowPlayingSnapshot();
  audioIsAdvancing = false;
  setVisualState(false);
  setStreamOffline(true);
  setStreamLoading(true);
});

window.addEventListener('online', () => {
  if (!shouldResumePlayback) return;
  setStreamLoading(true);
  if (radio?.paused) {
    startLiveStream();
  }
});

// Single writer for the station/schedule label. The resolved text is cached so
// it can be repainted synchronously (see restoreLiveRadioUi) without waiting on
// the network, then corrected once the next fetch settles.
function paintStationLabel(label) {
  lastStationLabel = label;
  if (stationNameEl) stationNameEl.innerText = label;
}

async function updateStationNameFromSchedule() {
  if (window.onDemandPlaybackActive || liveDataPaused) return;
  const requestId = ++scheduleRequestId;

  try {
    const response = await fetch(SCHEDULE_API, { cache: 'no-store' });
    const schedule = await response.json();
    // On-demand may have started while this request was in flight; that mode
    // owns the station label, so drop the late response.
    if (requestId !== scheduleRequestId || window.onDemandPlaybackActive || liveDataPaused) return;
    // The station mostly publishes "playlist" slots, so fall back to any
    // entry flagged is_now when no "live" slot is currently on air.
    const currentShow = schedule.find((item) => item.is_now === true && item.type === 'live') ||
      schedule.find((item) => item.is_now === true);

    if (!currentShow) {
      paintStationLabel('Thaalam 24x7');
      return;
    }

    const showName = currentShow.name || currentShow.streamer_name || 'Thaalam 24x7';
    if (currentShow.start && currentShow.end) {
      const start = new Date(currentShow.start);
      const end = new Date(currentShow.end);
      start.setMinutes(start.getMinutes() + 2);
      end.setMinutes(end.getMinutes() + 2);
      const formatTime = (date) => date.toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', hour12: true
      }).trim();
      paintStationLabel(`${showName} (${formatTime(start)} – ${formatTime(end)})`);
    } else {
      paintStationLabel(showName);
    }
  } catch (_) {
    if (requestId === scheduleRequestId && !window.onDemandPlaybackActive && !liveDataPaused) {
      paintStationLabel('Thaalam 24x7');
    }
  }
}

function updateAlbumArt(artworkUrl) {
  if (artworkUrl && artworkUrl === lastArtwork) return;

  const requestId = ++artworkRequestId;

  if (!artworkUrl) {
    lastArtwork = '';
    albumArtImage.src = 'album-placeholder.svg?v=2';
    albumArtImage.style.opacity = '1';
    if (miniPlayerArt) miniPlayerArt.src = 'album-placeholder.svg?v=2';
    return;
  }
  lastArtwork = artworkUrl;
  const image = new Image();
  image.onload = () => {
    if (requestId !== artworkRequestId) return;
    albumArtImage.style.opacity = '0';
    setTimeout(() => {
      if (requestId !== artworkRequestId) return;
      albumArtImage.src = artworkUrl;
      albumArtImage.style.opacity = '1';
      if (miniPlayerArt) miniPlayerArt.src = artworkUrl;
    }, 200);
  };
  image.onerror = () => {
    if (requestId !== artworkRequestId) return;
    albumArtImage.src = 'album-placeholder.svg?v=2';
    albumArtImage.style.opacity = '1';
    if (miniPlayerArt) miniPlayerArt.src = 'album-placeholder.svg?v=2';
  };
  image.src = artworkUrl;
  updateAlbumColors(artworkUrl, requestId);
}

async function updateNowPlaying() {
  if (window.onDemandPlaybackActive || liveDataPaused) return;
  const requestId = ++nowPlayingRequestId;

  try {
    const response = await fetch(`${NOW_PLAYING_API}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const rawData = await response.json();
    if (requestId !== nowPlayingRequestId) return;
    if (window.onDemandPlaybackActive || liveDataPaused) return;

    window.rawNowPlayingData = rawData;
    window.rawNowPlayingReceivedAt = performance.now() / 1000;
    const data = alignNowPlayingToAudio(rawData);
    window.latestNowPlayingData = data;
    window.awaitingFreshHlsPosition = false;
    if (!radio?.paused && data?.now_playing?.song) {
      window.lastAudibleNowPlayingData = data;
    }
    window.dispatchEvent(new CustomEvent('thaalam:nowplaying', {
      detail: data
    }));

    const nowPlaying = data?.now_playing;
    const song = nowPlaying?.song;
    window.currentNowPlayingSong = song || null;

    if (nowPlaying?.is_live && nowPlaying?.streamer_name) {
      paintStationLabel(`LIVE • ${nowPlaying.streamer_name}`);
    }

    if (!song) {
      updateAlbumArt('');
      return;
    }

    updateAlbumArt(song.art?.trim() || '');
    const title = song.title?.trim() || '';
    const artist = song.artist?.trim() || '';
    const songText = title ? `${title} – ${artist}` : artist;
    if (miniPlayerTitle) miniPlayerTitle.textContent = title || 'Thaalam 24x7';
    if (miniPlayerArtist) miniPlayerArtist.textContent = artist || 'Live radio';
    requestAnimationFrame(updateMiniPlayerMarquees);
    updateMiniPlayerTime();
    if (!songText) return;

    if (songText !== lastSongText) {
      lastSongText = songText;
      if (nowPlayingEl) {
        nowPlayingEl.dataset.trackTitle = title;
        nowPlayingEl.dataset.trackArtist = artist;
        nowPlayingEl.innerText = songText;
      }
      if (window.updateMarquee) window.updateMarquee();
    }
  } catch (error) {
    console.log('Now Playing update failed:', error);
  }
}

// On-demand playback paints the artwork, the now-playing text and the media
// metadata directly, without touching lastArtwork/lastSongText. Returning to
// live would therefore hit the "nothing changed" guards above and leave the
// on-demand song on screen, so drop both caches and re-run the same refresh
// pair used on page load (station/schedule label + now playing).
function restoreLiveRadioUi() {
  lastSongText = '';
  lastArtwork = '';
  // Drop the paused-stream snapshot: it is what keeps the UI frozen while the
  // stream is stalled, but here it would pin the pre-on-demand song on screen.
  // It is re-established by updateNowPlaying() once the stream resumes.
  window.lastAudibleNowPlayingData = null;
  // Repaint the cached show name synchronously so the label never sits on the
  // "Thaalam 24x7" placeholder while the schedule request is in flight.
  paintStationLabel(lastStationLabel);
  refreshStationAndTrackInfo();
}

window.restoreLiveRadioUi = restoreLiveRadioUi;

document.addEventListener('DOMContentLoaded', () => {
  if (radio) radio.preload = 'none';
  if (albumArtImage) albumArtImage.src = 'album-placeholder.svg?v=2';

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = 'icon-512.png?v=3';
  document.head.prepend(favicon);

  const albumBackground = document.createElement('div');
  albumBackground.className = 'album-background';
  document.body.prepend(albumBackground);

  const tagline = document.querySelector('.tagline');
  if (tagline && nowPlayingEl) {
    window.updateMarquee = () => {
      if (window.matchMedia('(min-width: 56.25rem) and (pointer: fine)').matches) {
        const likeButton = tagline.querySelector('.on-demand-like-button');
        const likeSpace = likeButton
          ? likeButton.offsetWidth + parseFloat(getComputedStyle(likeButton).marginLeft || '0')
          : 0;
        const availableWidth = Math.max(0, tagline.clientWidth - likeSpace);
        const measureText = (text, pseudo) => {
          const styles = getComputedStyle(nowPlayingEl, pseudo);
          const measure = document.createElement('span');
          measure.textContent = text;
          measure.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${styles.font};letter-spacing:${styles.letterSpacing};`;
          tagline.appendChild(measure);
          const width = measure.getBoundingClientRect().width;
          measure.remove();
          return width;
        };
        const titleWidth = measureText(nowPlayingEl.dataset.trackTitle || '', '::before');
        const artistWidth = measureText(nowPlayingEl.dataset.trackArtist || '', '::after');
        const titleDistance = Math.max(0, titleWidth - availableWidth);
        const artistDistance = Math.max(0, artistWidth - availableWidth);
        tagline.classList.toggle('title-marquee', titleDistance > 1);
        tagline.classList.toggle('artist-marquee', artistDistance > 1);
        nowPlayingEl.style.setProperty('--title-marquee-distance', `${-titleDistance}px`);
        nowPlayingEl.style.setProperty('--artist-marquee-distance', `${-artistDistance}px`);
        nowPlayingEl.style.setProperty('--title-marquee-duration', `${Math.max(18, (titleWidth + 180) / 24)}s`);
        nowPlayingEl.style.setProperty('--artist-marquee-duration', `${Math.max(18, (artistWidth + 180) / 24)}s`);
        return;
      }

      tagline.classList.remove('marquee');
      tagline.classList.remove('title-marquee', 'artist-marquee');
      requestAnimationFrame(() => {
        const likeButton = tagline.querySelector('.on-demand-like-button');
        const likeSpace = likeButton
          ? likeButton.offsetWidth + parseFloat(getComputedStyle(likeButton).marginLeft || '0')
          : 0;
        if (nowPlayingEl.scrollWidth > tagline.clientWidth - likeSpace) {
          tagline.classList.add('marquee');
        }
      });
    };
    window.updateMarquee();
    window.addEventListener('resize', window.updateMarquee);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.log('Service worker registration failed:', error);
    });
  }
});

function refreshStationAndTrackInfo() {
  updateStationNameFromSchedule();
  updateNowPlaying();
}

setVisualState(false);
showPlayIcon();
paintStationLabel(lastStationLabel);
refreshStationAndTrackInfo();
setInterval(updateStationNameFromSchedule, 60000);
setInterval(updateNowPlaying, 15000);
