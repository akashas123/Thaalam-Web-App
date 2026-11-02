const metadataRadio = document.getElementById('radio');
const fallbackArtwork = new URL('thaalam-icon-512.png?v=1', window.location.href).href;
let currentArtwork = '';
const defaultDocumentTitle = 'Thaalam 24x7';

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
  if (!window.onDemandPlaybackActive && metadataRadio.paused) {
    clearInactiveRadioMetadata();
    return;
  }

  const song = window.onDemandPlaybackActive
    ? window.currentNowPlayingSong
    : data?.now_playing?.song;
  if (!song) return;

  const title = String(song.title || '').trim() || 'Thaalam 24x7';
  const artist = String(song.artist || '').trim() || 'Thaalam 24x7';
  const album = String(song.album || '').trim() || 'Thaalam 24x7';
  const artworkSource = String(song.art || '').trim();
  let artwork = fallbackArtwork;
  try {
    if (artworkSource) artwork = new URL(artworkSource, window.location.href).href;
  } catch {
    // Keep an absolute local fallback so Chrome never retains the last song's
    // artwork when the next track has a missing or malformed image URL.
  }
  document.title = `${title} - ${artist}`;
  if (artworkSource) setFavicon(artwork);

}

function clearInactiveRadioMetadata() {
  if (window.onDemandPlaybackActive ||
      document.body.classList.contains('on-demand-active') ||
      !metadataRadio.paused) return;

  document.title = defaultDocumentTitle;
  setFavicon(fallbackArtwork);
}

function refreshNowPlayingMetadata(data = window.latestNowPlayingData) {
  if (data) applyNowPlayingMetadata(data);
}

window.addEventListener('thaalam:nowplaying', (event) => {
  refreshNowPlayingMetadata(event.detail);
});

new MutationObserver((records) => {
  if (records.some((record) => [...record.addedNodes].some((node) =>
    node.nodeType === Node.ELEMENT_NODE && node.matches?.('link[rel~="icon"]')
  ))) {
    if (currentArtwork) setFavicon(currentArtwork);
  }
}).observe(document.head, { childList: true });
