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
const miniShuffleButton = document.getElementById('miniShuffleButton');
const miniRepeatButton = document.getElementById('miniRepeatButton');
const miniLikeButton = document.getElementById('miniLikeButton');
const miniInfoButton = document.getElementById('miniInfoButton');
const miniVolumeButton = document.getElementById('miniVolumeButton');
const miniVolumeSlider = document.getElementById('miniVolumeSlider');
const miniVolumeValue = document.getElementById('miniVolumeValue');
const root = document.documentElement;

let browserThemeAnimation = 0;

function syncBrowserThemeColor(duration = 800) {
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (!themeColor) return;

  const parseHexColor = (hex) => {
    const match = /^#?([\da-f]{6})$/i.exec(hex.trim());
    if (!match) return [5, 7, 13];
    return [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16));
  };
  const from = parseHexColor(themeColor.content);
  const nowPlayingOpen = document.body.classList.contains('view-now-playing');
  const albumColor = getComputedStyle(root)
    .getPropertyValue('--album-dominant-color')
    .trim();
  // Keep the browser/PWA toolbar in sync with the artwork background overlay
  // used on Now Playing (black at 38% opacity in style.css).
  const target = nowPlayingOpen
    ? rgbToHex(...parseHexColor(albumColor).map((channel) => channel * 0.62))
    : '#05070d';
  const to = parseHexColor(target);
  if (duration <= 0) {
    themeColor.setAttribute('content', rgbToHex(...to));
    return;
  }
  const startedAt = performance.now();

  window.cancelAnimationFrame(browserThemeAnimation);
  const animate = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const t = (low + high) / 2;
      const inverse = 1 - t;
      const x = 3 * inverse * inverse * t * 0.4 + 3 * inverse * t * t * 0.2 + t * t * t;
      if (x < progress) low = t;
      else high = t;
    }
    const t = (low + high) / 2;
    const inverse = 1 - t;
    const eased = 3 * inverse * inverse * t * 0 + 3 * inverse * t * t * 1 + t * t * t;
    const color = rgbToHex(...from.map((channel, index) => channel + (to[index] - channel) * eased));
    themeColor.setAttribute('content', color);

    if (progress < 1) browserThemeAnimation = window.requestAnimationFrame(animate);
  };

  browserThemeAnimation = window.requestAnimationFrame(animate);
}

let browserThemeWasNowPlaying = document.body?.classList.contains('view-now-playing') || false;
const browserThemeObserver = new MutationObserver(() => {
  const nowPlayingOpen = document.body.classList.contains('view-now-playing');
  if (nowPlayingOpen === browserThemeWasNowPlaying) return;
  browserThemeWasNowPlaying = nowPlayingOpen;
  syncBrowserThemeColor(300);
});
if (document.body) {
  browserThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncBrowserThemeColor(0);
}

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
  // Native disclosure summaries need their default click action to toggle
  // their <details> content. They are not buttons, so let those clicks pass.
  if (event.target.closest('.recent-history-queue-summary')) return;
  // Mobile mini-player surfaces are clickable navigation targets, including
  // their non-button padding. Let the event bubble to #miniPlayer's handler.
  if (
    window.matchMedia('(max-width: 56.1875rem), (pointer: coarse) and (any-pointer: coarse)').matches &&
    event.target.closest('#miniPlayer')
  ) return;
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
    const buckets = new Map();

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha < 180) continue;

      const brightness = (red + green + blue) / 3;
      if (brightness < 12 || brightness > 248) continue;

      const key = `${red >> 4},${green >> 4},${blue >> 4}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += red;
      bucket.g += green;
      bucket.b += blue;
      buckets.set(key, bucket);

      if (index % 16 === 0) {
        candidates.push({
          r: red,
          g: green,
          b: blue,
          saturation: Math.max(red, green, blue) - Math.min(red, green, blue),
          brightness
        });
      }
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

    const dominant = [...buckets.values()].sort((first, second) => second.count - first.count)[0];
    if (!dominant) {
      root.style.setProperty('--album-dominant-color', '#080c14');
      setAlbumColors(Array(5).fill('#080c14'));
      return;
    }

    const averageBrightness = (dominant.r + dominant.g + dominant.b) / (dominant.count * 3);
    const multiplier = Math.min(1.65, Math.max(0.78, 138 / averageBrightness));
    const channels = [
      (dominant.r / dominant.count) * multiplier,
      (dominant.g / dominant.count) * multiplier,
      (dominant.b / dominant.count) * multiplier
    ];
    const relativeLuminance = (scale) => {
      const linear = channels.map((channel) => {
        const value = (channel * scale) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };

    let scale = 1;
    if (relativeLuminance(scale) > 0.1) {
      let low = 0;
      let high = 1;
      for (let iteration = 0; iteration < 14; iteration += 1) {
        const middle = (low + high) / 2;
        if (relativeLuminance(middle) <= 0.1) low = middle;
        else high = middle;
      }
      scale = low;
    }

    const color = rgbToHex(...channels.map((channel) => channel * scale));
    root.style.setProperty('--album-dominant-color', color);
    syncBrowserThemeColor();
    setAlbumColors(selected.map((sample) => {
      const sampleMultiplier = sample.brightness < 80 ? 1.25 : 0.72;
      return rgbToHex(
        sample.r * sampleMultiplier,
        sample.g * sampleMultiplier,
        sample.b * sampleMultiplier
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
  playButton?.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
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

/* Reveal the docked mini player the instant a track is selected, even before
   its audio is ready. On-demand playback spends time searching and buffering on
   YouTube, and until the first PLAYING event the player used to stay hidden, so
   the listener saw nothing happen for several seconds after tapping a song.
   This un-hides the mini player at once (its metadata is painted by the caller)
   and lets the audio finish loading behind it. */
function revealMiniPlayer() {
  if (!hasStartedPlayback) {
    hasStartedPlayback = true;
    try {
      localStorage.setItem(PLAYBACK_STARTED_KEY, 'true');
    } catch {
    }
  }
  document.body.classList.add('mini-player-visible');
  if (miniPlayer) miniPlayer.hidden = false;
}

window.revealMiniPlayer = revealMiniPlayer;

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

function updateMiniPlayerProgress(elapsed, duration) {
  if (!miniPlayerProgressFill) return;
  const safeDuration = Number(duration);
  const safeElapsed = Number(elapsed);
  const percent = Number.isFinite(safeDuration) && safeDuration > 0 && Number.isFinite(safeElapsed)
    ? Math.min(100, Math.max(0, (safeElapsed / safeDuration) * 100))
    : 0;
  miniPlayerProgressFill.style.display = 'block';
  // Keep a small white leading edge visible even at the very start of a
  // track; on narrow mobile bars a sub-pixel fill can otherwise disappear.
  miniPlayerProgressFill.style.width = `${Math.max(1.5, percent)}%`;
  miniPlayerProgress?.setAttribute('aria-valuenow', String(Math.round(percent)));
}

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
  // Keep the exact rendered live position while paused. The live clock can
  // still be re-synced by incoming metadata, which otherwise makes the mini
  // fill jump between the frozen point and the stream's reported position.
  if (radio?.paused || window.awaitingFreshHlsPosition) return;

  const clock = window.getAudibleTrackClock?.();
  if (clock) {
    // Clamp to the duration so the live mini clock never reads past the end
    // of the song currently on air (matches the Now Playing readout).
    const duration = Number(clock.duration) || 0;
    const elapsed = duration > 0 ? Math.min(clock.elapsed, duration) : clock.elapsed;
    miniPlayerElapsed.textContent = formatMiniTime(elapsed);
    miniPlayerDuration.textContent = formatMiniTime(duration);
    updateMiniPlayerProgress(elapsed, duration);
    return;
  }
  const elapsedText = document.getElementById('trackElapsed')?.textContent || '0:00';
  const durationText = document.getElementById('trackDuration')?.textContent || '0:00';
  miniPlayerElapsed.textContent = elapsedText;
  miniPlayerDuration.textContent = durationText;
  const parseMiniTime = (value) => {
    const parts = String(value).trim().split(':').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite)
      ? parts[0] * 60 + parts[1]
      : NaN;
  };
  updateMiniPlayerProgress(parseMiniTime(elapsedText), parseMiniTime(durationText));
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
bindMiniPlayerProxy(miniShuffleButton, 'onDemandShuffleButton');
bindMiniPlayerProxy(miniRepeatButton, 'onDemandRepeatButton');
miniInfoButton?.addEventListener('click', () => {
  const onDemand = Boolean(window.onDemandPlaybackActive);
  const source = onDemand
    ? window.getCurrentOnDemandSong?.()
    : window.latestNowPlayingData?.now_playing?.song || window.currentNowPlayingSong;
  const title = source?.trackName || source?.title || '';
  const artist = source?.artistName || source?.artist || '';
  if (!title || !artist || typeof window.openCatalogSongInfo !== 'function') return;

  const clock = onDemand ? window.getOnDemandTrackClock?.() : null;
  const duration = Number(source.trackTimeMillis) ||
    Number(source.duration) * 1000 ||
    Number(clock?.duration) * 1000 || 0;
  window.openCatalogSongInfo({
    trackName: title,
    artistName: artist,
    collectionName: source.collectionName || source.album || source.album_name || '',
    artworkUrl100: source.artworkUrl100 || source.art || '',
    primaryGenreName: source.primaryGenreName || source.genre || '',
    releaseDate: source.releaseDate || '',
    trackTimeMillis: duration
  }, miniInfoButton);
});

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
  miniPlayer?.classList.toggle('is-on-demand', onDemandActive);
  miniNextButton?.classList.toggle('is-on-demand', onDemandActive);
  const prevButton = document.getElementById('onDemandPrevButton');
  const nextButton = document.getElementById('onDemandNextButton');
  const likeButton = document.getElementById('onDemandLikeButton');
  const thumbsUp = document.getElementById('thumbsUpButton');

  if (miniPrevButton) miniPrevButton.disabled = !onDemandActive || Boolean(prevButton?.disabled);
  if (miniNextButton) miniNextButton.disabled = !onDemandActive || Boolean(nextButton?.disabled);

  const shuffleButton = document.getElementById('onDemandShuffleButton');
  const repeatButton = document.getElementById('onDemandRepeatButton');
  for (const [miniButton, sourceButton] of [[miniShuffleButton, shuffleButton], [miniRepeatButton, repeatButton]]) {
    if (!miniButton) continue;
    const pressed = sourceButton?.getAttribute('aria-pressed') === 'true';
    miniButton.disabled = !onDemandActive || !sourceButton || Boolean(sourceButton.disabled);
    miniButton.setAttribute('aria-pressed', String(pressed));
    miniButton.setAttribute('aria-label', sourceButton?.getAttribute('aria-label') || (miniButton === miniShuffleButton ? 'Shuffle off' : 'Repeat off'));
    miniButton.title = miniButton === miniShuffleButton ? 'Shuffle' : 'Repeat';
    miniButton.dataset.repeatMode = sourceButton?.dataset.repeatMode || 'off';
    miniButton.classList.toggle('is-active', sourceButton?.classList.contains('is-active') || false);
  }

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
    const source = onDemandActive
      ? window.getCurrentOnDemandSong?.()
      : window.latestNowPlayingData?.now_playing?.song || window.currentNowPlayingSong;
    miniInfoButton.disabled = !Boolean(
      (source?.trackName || source?.title) && (source?.artistName || source?.artist)
    );
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
const DEFAULT_VOLUME = 50;
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
    const raw = localStorage.getItem(VOLUME_LEVEL_KEY);
    // A missing key returns null and Number(null) === 0, which would wrongly
    // report silence for a brand-new visitor; treat it as "not set".
    const value = raw === null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  } catch (_) { /* fall through to default */ }
  return DEFAULT_VOLUME;
}

// Shared with ondemand-player.js so the on-demand player starts at the same
// stored/default level as the live radio.
window.getStoredVolumeLevel = getStoredVolume;

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
   the on-demand <audio> element takes 0-100 via the bridge exposed in
   ondemand-player.js. */
function applyVolumeLevel(level, { persist = false } = {}) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  currentVolumeLevel = clamped;
  if (radio) radio.volume = clamped / 100;
  if (typeof window.setOnDemandVolume === 'function') window.setOnDemandVolume(clamped);
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
  // On-demand <audio> element (exposed by ondemand-player.js).
  if (typeof window.setOnDemandMuted === 'function') window.setOnDemandMuted(muted);
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
    // Drop the marquee state before measuring: the active ::before holds a
    // duplicated copy of the text and inflates scrollWidth, which would keep
    // the marquee running even after switching to a track that fits.
    element.classList.remove('is-marquee');
    const scrollWidth = element.scrollWidth;
    const isOverflowing = scrollWidth > element.clientWidth + 1;
    if (isOverflowing) {
      element.classList.add('is-marquee');
      element.style.setProperty(
        '--mini-marquee-duration',
        `${Math.max(14, (scrollWidth + 120) / 30)}s`
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
    streamQuality.textContent = 'SPATIAL';
    streamQuality.setAttribute(
      'aria-label',
      'Spatial sound enabled for on-demand audio'
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
    streamQuality.textContent = 'SPATIAL';
    streamQuality.setAttribute(
      'aria-label',
      'Spatial sound enabled for on-demand audio'
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

document.addEventListener('keydown', (event) => {
  if (event.repeat || event.defaultPrevented || !miniPlayer || miniPlayer.hidden ||
      miniPlayer.getClientRects().length === 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest(
    'input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"], [role="slider"]'
  )) return;

  const key = event.code === 'Space' ? 'space' : event.key.toLowerCase();
  const shortcuts = {
    space: null,
    arrowleft: miniPrevButton,
    arrowright: miniNextButton,
    s: miniShuffleButton,
    r: miniRepeatButton,
    l: miniLikeButton,
    i: miniInfoButton,
    m: miniVolumeButton
  };
  if (key === '+' || key === '=') {
    event.preventDefault();
    applyVolumeLevel(Number(miniVolumeSlider?.value || 0) + 5, { persist: true });
    return;
  }
  if (key === '-') {
    event.preventDefault();
    applyVolumeLevel(Number(miniVolumeSlider?.value || 0) - 5, { persist: true });
    return;
  }
  if (!(key in shortcuts)) return;

  event.preventDefault();
  if (key === 'space') {
    togglePlay();
    return;
  }
  const button = shortcuts[key];
  if (button && !button.disabled) button.click();
});

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
    albumArtImage.src = 'album-placeholder.svg?v=3';
    albumArtImage.style.opacity = '1';
    if (miniPlayerArt) miniPlayerArt.src = 'album-placeholder.svg?v=3';
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
    albumArtImage.src = 'album-placeholder.svg?v=3';
    albumArtImage.style.opacity = '1';
    if (miniPlayerArt) miniPlayerArt.src = 'album-placeholder.svg?v=3';
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
    const nowPlaying = data?.now_playing;
    const song = nowPlaying?.song;
    window.currentNowPlayingSong = song || null;
    window.dispatchEvent(new CustomEvent('thaalam:nowplaying', { detail: data }));

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
  if (albumArtImage) albumArtImage.src = 'album-placeholder.svg?v=3';

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = 'thaalam-icon-512.png?v=1';
  document.head.prepend(favicon);

  const albumBackground = document.createElement('div');
  albumBackground.className = 'album-background';
  document.body.prepend(albumBackground);

  const tagline = document.querySelector('.tagline');
  if (tagline && nowPlayingEl) {
    window.updateMarquee = () => {
      if (!window.__THAALAM_FORCE_MOBILE_LAYOUT__ &&
          window.matchMedia('(min-width: 56.25rem) and (pointer: fine) and (any-pointer: fine)').matches) {
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
        nowPlayingEl.style.setProperty('--title-marquee-duration', `${Math.max(14, (titleWidth + 140) / 30)}s`);
        nowPlayingEl.style.setProperty('--artist-marquee-duration', `${Math.max(14, (artistWidth + 140) / 30)}s`);
        return;
      }

      tagline.classList.remove('marquee', 'title-marquee', 'artist-marquee');
      requestAnimationFrame(() => {
        if (!document.body.classList.contains('on-demand-active')) {
          if (nowPlayingEl.scrollWidth > tagline.clientWidth) tagline.classList.add('marquee');
          return;
        }

        const availableWidth = nowPlayingEl.clientWidth;
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
        tagline.classList.toggle('title-marquee', titleWidth > availableWidth + 1);
        tagline.classList.toggle('artist-marquee', artistWidth > availableWidth + 1);
        nowPlayingEl.style.setProperty('--title-marquee-duration', `${Math.max(14, (titleWidth + 140) / 30)}s`);
        nowPlayingEl.style.setProperty('--artist-marquee-duration', `${Math.max(14, (artistWidth + 140) / 30)}s`);
      });
    };
    window.updateMarquee();
    window.addEventListener('resize', window.updateMarquee);
  }

  if ('serviceWorker' in navigator) {
    let hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // skipWaiting() + clients.claim() moves every open PWA client to the new
      // worker. Reload each controlled client once so it fetches the matching
      // HTML and assets; this also works for later updates in the same tab.
      if (!hadServiceWorkerController) {
        hadServiceWorkerController = true;
        return;
      }
      window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        // Check for deployed updates while the app is in the foreground. A
        // background PWA can have its network suspended by the browser, which
        // makes periodic Service Worker script fetches fail noisily.
        const checkForServiceWorkerUpdate = () => {
          if (document.visibilityState !== 'visible') return;
          registration.update().catch(() => {
            // A temporary update check failure is safe: the current worker
            // keeps serving the app and visibilitychange will retry on return.
          });
        };
        setInterval(checkForServiceWorkerUpdate, 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForServiceWorkerUpdate();
        });
      })
      .catch((error) => {
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
