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
  if (window.onDemandPlaybackActive
    ? !window.isOnDemandAudioPlaying?.()
    : metadataRadio.paused) {
    clearInactiveRadioMetadata();
    return;
  }

  // A delayed radio update must never replace the current on-demand song's
  // title or artwork in Chrome's shared media session.
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

  if (navigator.mediaSession && 'MediaMetadata' in window) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: [{ src: artwork, sizes: '512x512' }]
      });
    } catch (error) {
      console.warn('Could not update media session metadata:', error);
    }
  }
}

function clearInactiveRadioMetadata() {
  if (window.onDemandPlaybackActive
    ? window.isOnDemandAudioPlaying?.()
    : !metadataRadio.paused) return;

  document.title = defaultDocumentTitle;
  setFavicon(fallbackArtwork);
  if (!navigator.mediaSession) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch (error) {
    console.warn('Could not clear inactive radio media metadata:', error);
  }
}

function refreshNowPlayingMetadata(data = window.latestNowPlayingData) {
  if (data) applyNowPlayingMetadata(data);
}

window.addEventListener('thaalam:nowplaying', (event) => {
  refreshNowPlayingMetadata(event.detail);
});

function refreshVisibleMediaSession() {
  if (document.visibilityState !== 'visible') return;
  refreshNowPlayingMetadata(
    window.onDemandPlaybackActive
      ? { now_playing: { song: window.currentNowPlayingSong } }
      : window.latestNowPlayingData
  );
}

document.addEventListener('visibilitychange', refreshVisibleMediaSession);
window.addEventListener('pageshow', refreshVisibleMediaSession);
window.addEventListener('thaalam:on-demand-playback-state', refreshVisibleMediaSession);

if (window.latestNowPlayingData) {
  refreshNowPlayingMetadata(window.latestNowPlayingData);
}

if (navigator.mediaSession) {
  try {
    navigator.mediaSession.setActionHandler('play', () => {
      if (window.onDemandPlaybackActive) window.toggleOnDemandPlayback?.();
      else metadataRadio.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (window.onDemandPlaybackActive) window.toggleOnDemandPlayback?.(false);
      else metadataRadio.pause();
    });
  } catch (error) {
    console.log('Media controls are not supported:', error);
  }
  metadataRadio.addEventListener('play', () => {
    if (window.onDemandPlaybackActive) return;
    navigator.mediaSession.playbackState = 'playing';
  });
  metadataRadio.addEventListener('playing', () => {
    if (window.onDemandPlaybackActive) return;
    navigator.mediaSession.playbackState = 'playing';
  });
  metadataRadio.addEventListener('pause', () => {
    if (window.onDemandPlaybackActive) return;
    clearInactiveRadioMetadata();
  });
}

metadataRadio.addEventListener('play', () => {
  if (window.onDemandPlaybackActive) return;
  refreshNowPlayingMetadata(window.latestNowPlayingData);
});

new MutationObserver((records) => {
  if (records.some((record) => [...record.addedNodes].some((node) =>
    node.nodeType === Node.ELEMENT_NODE && node.matches?.('link[rel~="icon"]')
  ))) {
    if (currentArtwork) setFavicon(currentArtwork);
  }
}).observe(document.head, { childList: true });
