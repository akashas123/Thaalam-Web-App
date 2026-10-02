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
let artworkRequestId = 0;
let nowPlayingRequestId = 0;
let isConnecting = false;
let isStreamOffline = false;
let shouldResumePlayback = false;
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

function updateMiniPlayerTime() {
  if (!miniPlayerElapsed || !miniPlayerDuration) return;
  const clock = window.getAudibleTrackClock?.();
  if (clock) {
    miniPlayerElapsed.textContent = formatMiniTime(clock.elapsed);
    miniPlayerDuration.textContent = formatMiniTime(clock.duration);
    return;
  }
  miniPlayerElapsed.textContent = document.getElementById('trackElapsed')?.textContent || '0:00';
  miniPlayerDuration.textContent = document.getElementById('trackDuration')?.textContent || '0:00';
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
setInterval(updateMiniPlayerTime, 250);
window.addEventListener('resize', updateMiniPlayerMarquees);

function setStreamOffline(isOffline) {
  if (!streamQuality) return;

  isStreamOffline = isOffline;
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
  if (!streamQuality) return;

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
async function startLiveStream() {
  if (isConnecting || !radio) return;
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
      elapsed: Number.isFinite(audibleDuration) && audibleDuration > 0
        ? Math.min(audibleElapsed, audibleDuration)
        : audibleElapsed,
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
  const elapsed = duration > 0
    ? Math.min(clock.elapsed, duration)
    : clock.elapsed;

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
  if (!radio) return;
  if (radio.paused) {
    shouldResumePlayback = true;
    startLiveStream();
  } else {
    shouldResumePlayback = false;
    window.clearTimeout(streamStallTimer);
    setStreamLoading(false);
    setStreamOffline(false);
    radio.pause();
  }
}

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

async function updateStationNameFromSchedule() {
  try {
    const response = await fetch(SCHEDULE_API, { cache: 'no-store' });
    const schedule = await response.json();
    const currentShow = schedule.find((item) => item.is_now === true && item.type === 'live') ||
      schedule.find((item) => item.is_now === true);

    if (!currentShow) {
      stationNameEl.innerText = 'Thaalam 24x7';
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
      stationNameEl.innerText = `${showName} (${formatTime(start)} – ${formatTime(end)})`;
    } else {
      stationNameEl.innerText = showName;
    }
  } catch (_) {
    if (stationNameEl) stationNameEl.innerText = 'Thaalam 24x7';
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
  const requestId = ++nowPlayingRequestId;

  try {
    const response = await fetch(`${NOW_PLAYING_API}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const rawData = await response.json();
    if (requestId !== nowPlayingRequestId) return;

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

    if (nowPlaying?.is_live && nowPlaying?.streamer_name && stationNameEl) {
      stationNameEl.innerText = `LIVE • ${nowPlaying.streamer_name}`;
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

document.addEventListener('DOMContentLoaded', () => {
  if (radio) radio.preload = 'none';
  if (albumArtImage) albumArtImage.src = 'album-placeholder.svg?v=2';

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = 'icon-512.png?v=2';
  document.head.prepend(favicon);

  const albumBackground = document.createElement('div');
  albumBackground.className = 'album-background';
  document.body.prepend(albumBackground);

  const tagline = document.querySelector('.tagline');
  if (tagline && nowPlayingEl) {
    window.updateMarquee = () => {
      if (window.matchMedia('(min-width: 56.25rem) and (pointer: fine)').matches) {
        const availableWidth = tagline.clientWidth;
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
        if (nowPlayingEl.scrollWidth > tagline.clientWidth) {
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
refreshStationAndTrackInfo();
setInterval(updateStationNameFromSchedule, 60000);
setInterval(updateNowPlaying, 15000);
