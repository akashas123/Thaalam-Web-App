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

let youtubeApiPromise = null;
let youtubePlayerPromise = null;
let youtubePlayer = null;
let youtubePlayerReady = false;
let requestedVideoId = '';
let selectedDuration = 0;
let songRequestId = 0;
let videoCandidates = [];
let videoCandidateIndex = 0;

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
    window.onYouTubeIframeAPIReady = () => {
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      youtubeApiPromise = null;
      reject(new Error('YouTube player failed to load.'));
    };
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

function updateOnDemandTime() {
  if (!window.onDemandPlaybackActive) return;

  let elapsed = 0;
  let duration = selectedDuration;
  if (youtubePlayerReady) {
    elapsed = youtubePlayer.getCurrentTime() || 0;
    duration = youtubePlayer.getDuration() || duration;
  }

  onDemandElapsed.textContent = formatOnDemandTime(elapsed);
  onDemandDuration.textContent = formatOnDemandTime(duration);
}

function setOnDemandPlaying(isPlaying) {
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
  if (!window.onDemandPlaybackActive) return;

  const states = window.YT.PlayerState;
  if (event.data === states.PLAYING) {
    onDemandModeLabel.textContent = 'ON DEMAND';
    setOnDemandPlaying(true);
  } else if (event.data === states.BUFFERING) {
    onDemandModeLabel.textContent = 'BUFFERING';
    onDemandPlayButton?.classList.add('is-loading');
  } else if (
    event.data === states.PAUSED ||
    event.data === states.ENDED ||
    event.data === states.CUED
  ) {
    onDemandModeLabel.textContent = 'ON DEMAND';
    setOnDemandPlaying(false);
  }
}

function handleYouTubeError(event) {
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
  onDemandArtwork.hidden = true;

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
  const artist = song.artistName || video.artist || 'Unknown artist';
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
  onDemandStation.textContent = 'YouTube Music';
  onDemandModeLabel.textContent = 'LOADING';
  onDemandTrack.dataset.trackTitle = title;
  onDemandTrack.dataset.trackArtist = artist;
  onDemandTrack.textContent = `${title} – ${artist}`;
  onDemandMiniTitle.textContent = title;
  onDemandMiniArtist.textContent = artist;
  if (artwork) {
    onDemandArtwork.src = artwork;
    onDemandMiniArtwork.src = artwork;
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

async function startOnDemandSong(song) {
  if (!song?.trackName) return;
  const requestId = ++songRequestId;
  selectedDuration = Number(song.trackTimeMillis) / 1000 || 0;
  window.onDemandPlaybackActive = true;
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

    const query = new URLSearchParams({
      title: song.trackName,
      artist: song.artistName || ''
    });
    const response = await fetch(`/api/youtube/search?${query}`, { cache: 'no-store' });
    const video = await response.json();
    if (!response.ok) throw new Error(video.error || 'No matching YouTube video was found.');
    if (requestId !== songRequestId) return;

    videoCandidates = [...new Set([video.videoId, ...(video.alternatives || [])])];
    videoCandidateIndex = 0;
    selectedDuration = parseVideoDuration(video.duration) || selectedDuration;
    updateOnDemandMetadata(song, video);
    await loadVideo(video.videoId, requestId);
    updateOnDemandTime();
  } catch (error) {
    if (requestId !== songRequestId) return;
    console.error('Unable to start on-demand playback:', error);
    onDemandModeLabel.textContent = 'UNAVAILABLE';
    const message = error instanceof TypeError && error.message === 'Failed to fetch'
      ? 'On-demand server offline. Open localhost:8000.'
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

function returnToLive() {
  if (!window.onDemandPlaybackActive) return;
  songRequestId += 1;
  if (youtubePlayerReady) youtubePlayer.pauseVideo();
  window.onDemandPlaybackActive = false;
  onDemandMount.hidden = true;
  onDemandArtwork.hidden = false;
  returnToLiveButton.hidden = true;
  onDemandModeLabel.textContent = 'LIVE';
  onDemandStation.textContent = 'Thaalam 24x7';
  onDemandPlayButton.disabled = false;
  onDemandMiniToggle.disabled = false;
  onDemandElapsed.textContent = '0:00';
  onDemandDuration.textContent = '0:00';
  setOnDemandPlaying(false);
  window.updateNowPlaying?.();
  window.togglePlay?.();
}

window.startOnDemandSong = startOnDemandSong;
window.toggleOnDemandPlayback = toggleOnDemandPlayback;
window.getOnDemandTrackClock = () => {
  if (!window.onDemandPlaybackActive) return null;
  return {
    elapsed: youtubePlayerReady ? youtubePlayer.getCurrentTime() || 0 : 0,
    duration: youtubePlayerReady ? youtubePlayer.getDuration() || selectedDuration : selectedDuration
  };
};

returnToLiveButton.addEventListener('click', returnToLive);
window.setInterval(updateOnDemandTime, 500);