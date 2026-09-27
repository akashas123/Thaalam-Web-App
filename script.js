const HLS_STREAM_URL = 'https://radio.thaalam24x7.in/hls/thaalam_24x7/live.m3u8';
const NOW_PLAYING_API = 'https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7';
const SCHEDULE_API = 'https://radio.thaalam24x7.in/api/station/6/schedule';

const radio = document.getElementById('radio');
const playIcon = document.getElementById('playIcon');
const nowPlayingEl = document.getElementById('nowPlaying');
const stationNameEl = document.getElementById('stationName');
const logo = document.getElementById('logoImg');
const root = document.documentElement;

let lastSongText = '';
let lastArtwork = '';
let isConnecting = false;
let hlsPlayer = null;

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

function updateAlbumColors(imageUrl) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => extractAlbumColors(image);
  image.onerror = () => console.log('Album artwork could not be loaded for color extraction');
  image.src = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}color=${Date.now()}`;
}

function setVisualState(isPlaying) {
  const tagline = document.querySelector('.tagline');
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
}

function showPauseIcon() {
  if (playIcon) playIcon.innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
}

async function startLiveStream() {
  if (isConnecting || !radio) return;
  isConnecting = true;

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
        player.once(window.Hls.Events.MANIFEST_PARSED, () => {
          radio.play().then(resolve, reject);
        });
        player.on(window.Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
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

    await updateNowPlaying();
  } catch (error) {
    console.log('Unable to start live stream:', error);
  } finally {
    isConnecting = false;
  }
}

function togglePlay() {
  if (!radio) return;
  if (radio.paused) {
    startLiveStream();
  } else {
    radio.pause();
  }
}

if (radio) {
  radio.addEventListener('playing', () => {
    setVisualState(true);
    showPauseIcon();
  });
  radio.addEventListener('pause', () => {
    setVisualState(false);
    showPlayIcon();
  });
}

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
  if (!artworkUrl) {
    logo.src = 'logo.png';
    logo.style.opacity = '1';
    lastArtwork = '';
    return;
  }
  if (artworkUrl === lastArtwork) return;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    logo.style.opacity = '0';
    setTimeout(() => {
      logo.src = artworkUrl;
      logo.style.opacity = '1';
    }, 200);
  };
  image.onerror = () => {
    logo.src = 'logo.png';
    logo.style.opacity = '1';
  };
  image.src = artworkUrl;
  updateAlbumColors(artworkUrl);
  lastArtwork = artworkUrl;
}

async function updateNowPlaying() {
  try {
    const response = await fetch(`${NOW_PLAYING_API}?t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    const nowPlaying = data?.now_playing;
    const song = nowPlaying?.song;

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
    if (!songText) return;

    if (songText !== lastSongText) {
      lastSongText = songText;
      if (nowPlayingEl) nowPlayingEl.innerText = songText;
      if (window.updateMarquee) window.updateMarquee();
    }
  } catch (error) {
    console.log('Now Playing update failed:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (radio) radio.preload = 'none';
  if (logo) logo.src = 'logo.png';

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = 'logo.png';
  document.head.prepend(favicon);

  const albumBackground = document.createElement('div');
  albumBackground.className = 'album-background';
  document.body.prepend(albumBackground);

  const tagline = document.querySelector('.tagline');
  if (tagline && nowPlayingEl) {
    window.updateMarquee = () => {
      tagline.classList.remove('marquee');
      requestAnimationFrame(() => {
        if (nowPlayingEl.scrollWidth > tagline.clientWidth) {
          tagline.classList.add('marquee');
        }
      });
    };
    window.updateMarquee();
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