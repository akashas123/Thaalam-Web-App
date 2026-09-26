const metadataRadio = document.getElementById('radio');
const metadataApi = 'https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7';
const fallbackArtwork = new URL('logo.png', window.location.href).href;
let metadataLoaded = false;
let currentArtwork = fallbackArtwork;

function setFavicon(artwork) {
  currentArtwork = artwork;
  document.querySelectorAll('link[rel~="icon"]').forEach((link) => {
    link.href = artwork;
  });

  let favicon = document.querySelector('link[data-now-playing-favicon]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.dataset.nowPlayingFavicon = 'true';
    document.head.appendChild(favicon);
  }
  favicon.href = artwork;
}

function applyNowPlayingMetadata(data) {
  const nowPlaying = data?.now_playing;
  const song = nowPlaying?.song;
  if (!song) return;

  const title = song.title?.trim() || 'Thaalam 24x7';
  const artist = song.artist?.trim() || 'Thaalam 24x7';
  const album = song.album?.trim() || 'Thaalam 24x7';
  const artwork = song.art?.trim() || fallbackArtwork;
  document.title = `${title} - ${artist} | Thaalam 24x7`;
  setFavicon(artwork);

  if (navigator.mediaSession && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: [{ src: artwork, sizes: '512x512' }]
    });
  }
}

async function refreshNowPlayingMetadata() {
  if (metadataRadio.paused && metadataLoaded) return;

  try {
    const response = await fetch(`${metadataApi}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    applyNowPlayingMetadata(await response.json());
    metadataLoaded = true;
  } catch (error) {
    console.log('Browser media metadata update failed:', error);
  }
}

if (navigator.mediaSession) {
  try {
    navigator.mediaSession.setActionHandler('play', () => metadataRadio.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => metadataRadio.pause());
  } catch (error) {
    console.log('Media controls are not supported:', error);
  }
  metadataRadio.addEventListener('play', () => {
    navigator.mediaSession.playbackState = 'playing';
  });
  metadataRadio.addEventListener('playing', () => {
    navigator.mediaSession.playbackState = 'playing';
  });
  metadataRadio.addEventListener('pause', () => {
    navigator.mediaSession.playbackState = 'paused';
  });
}

refreshNowPlayingMetadata();
setInterval(refreshNowPlayingMetadata, 15000);
metadataRadio.addEventListener('play', refreshNowPlayingMetadata);

new MutationObserver((records) => {
  if (records.some((record) => [...record.addedNodes].some((node) =>
    node.nodeType === Node.ELEMENT_NODE && node.matches?.('link[rel~="icon"]')
  ))) {
    setFavicon(currentArtwork);
  }
}).observe(document.head, { childList: true });
