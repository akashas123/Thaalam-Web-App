const metadataRadio = document.getElementById('radio');
const fallbackArtwork = new URL('album-placeholder.svg?v=2', window.location.href).href;
let currentArtwork = '';

function setFavicon(artwork) {
  if (!artwork) return;
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
  if (song.art?.trim()) setFavicon(artwork);

  if (navigator.mediaSession && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: [{ src: artwork, sizes: '512x512' }]
    });
  }
}

function refreshNowPlayingMetadata(data = window.latestNowPlayingData) {
  if (data) applyNowPlayingMetadata(data);
}

window.addEventListener('thaalam:nowplaying', (event) => {
  refreshNowPlayingMetadata(event.detail);
});

if (window.latestNowPlayingData) {
  refreshNowPlayingMetadata(window.latestNowPlayingData);
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

metadataRadio.addEventListener('play', () => {
  refreshNowPlayingMetadata(window.latestNowPlayingData);
});

new MutationObserver((records) => {
  if (records.some((record) => [...record.addedNodes].some((node) =>
    node.nodeType === Node.ELEMENT_NODE && node.matches?.('link[rel~="icon"]')
  ))) {
    if (currentArtwork) setFavicon(currentArtwork);
  }
}).observe(document.head, { childList: true });
