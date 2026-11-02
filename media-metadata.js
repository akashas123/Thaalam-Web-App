const metadataRadio = document.getElementById('radio');
const fallbackArtwork = new URL('thaalam-icon-512.png?v=1', window.location.href).href;
let currentArtwork = '';
const defaultDocumentTitle = 'Thaalam 24x7';
let onDemandMediaSessionRefreshId = 0;

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

  if (window.onDemandPlaybackActive && navigator.mediaSession &&
      'MediaMetadata' in window) {
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

function refreshVisibleMediaSession() {
  if (!window.onDemandPlaybackActive) return;
  registerMediaSessionPlaybackHandlers();
  refreshNowPlayingMetadata(
    { now_playing: { song: window.currentNowPlayingSong } }
  );
  if (navigator.mediaSession) {
    try {
      navigator.mediaSession.playbackState = window.onDemandPlaying ? 'playing' : 'paused';
    } catch (error) {
      console.warn('Could not refresh on-demand media playback state:', error);
    }
  }
}

function scheduleOnDemandMediaSessionRefresh() {
  const refreshId = ++onDemandMediaSessionRefreshId;
  [0, 250, 1000].forEach((delay) => {
    window.setTimeout(() => {
      if (refreshId !== onDemandMediaSessionRefreshId ||
          !window.onDemandPlaybackActive || !window.onDemandPlaying) return;
      refreshVisibleMediaSession();
    }, delay);
  });
}

document.addEventListener('visibilitychange', refreshVisibleMediaSession);
window.addEventListener('pageshow', refreshVisibleMediaSession);

function registerMediaSessionPlaybackHandlers() {
  if (!navigator.mediaSession?.setActionHandler) return;
  const isOnDemand = Boolean(window.onDemandPlaybackActive);
  try {
    navigator.mediaSession.setActionHandler(
      'play',
      isOnDemand ? () => window.toggleOnDemandPlayback?.(true) : null
    );
  } catch (error) {
    console.log('Media play control is not supported:', error);
  }
  try {
    navigator.mediaSession.setActionHandler(
      'pause',
      isOnDemand ? () => window.toggleOnDemandPlayback?.(false) : null
    );
  } catch (error) {
    console.log('Media pause control is not supported:', error);
  }
  if (!isOnDemand) {
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch (error) {
      console.warn('Could not clear inactive on-demand media session:', error);
    }
  }
}

if (navigator.mediaSession) {
  registerMediaSessionPlaybackHandlers();
  const syncOnDemandMediaSession = () => {
    registerMediaSessionPlaybackHandlers();
    if (!window.onDemandPlaybackActive) {
      onDemandMediaSessionRefreshId += 1;
      return;
    }
    refreshVisibleMediaSession();
    if (window.onDemandPlaying) scheduleOnDemandMediaSessionRefresh();
  };
  window.addEventListener('thaalam:on-demand-playback-state', syncOnDemandMediaSession);
  window.addEventListener('thaalam:nowplaying', syncOnDemandMediaSession);
}

new MutationObserver((records) => {
  if (records.some((record) => [...record.addedNodes].some((node) =>
    node.nodeType === Node.ELEMENT_NODE && node.matches?.('link[rel~="icon"]')
  ))) {
    if (currentArtwork) setFavicon(currentArtwork);
  }
}).observe(document.head, { childList: true });
