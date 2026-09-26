const lyricsPanel = document.getElementById('lyricsPanel');
const lyricsToggle = document.getElementById('lyricsToggle');
const lyricsSong = document.getElementById('lyricsSong');
const lyricsContent = document.getElementById('lyricsContent');
const lyricsNotice = document.getElementById('lyricsNotice');
const lyricsRadio = document.getElementById('radio');
const lyricsApi = 'https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7';
const LYRICS_SYNC_OFFSET_SECONDS = 2;
let syncedLines = [];
let currentSongId = '';
let songStartedAt = 0;
let activeLyricIndex = -1;
let lastLyricsWereSynced = false;
let hasFetchedLyrics = false;
let streamIsActive = false;
let mobilePlayerViewChosen = false;
let lastMobileScrollPosition = 0;
let mobileTouchStartY = 0;

function getLyrics(data) {
  const song = data?.now_playing?.song;
  const candidates = [
    data?.lyrics,
    data?.now_playing?.lyrics,
    song?.lyrics
  ];

  const lyrics = candidates.find((value) => {
    return typeof value === 'string' ? value.trim() : Array.isArray(value) && value.length;
  });

  return Array.isArray(lyrics) ? lyrics.join('\n') : lyrics?.trim() || '';
}

function parseLyrics(lyrics) {
  const lines = lyrics.split(/\r?\n/);
  const timestampPattern = /\[(\d{1,2}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
  const parsedLines = [];

  lines.forEach((line) => {
    const timestamps = [...line.matchAll(timestampPattern)];
    const text = line.replace(timestampPattern, '').trim();

    timestamps.forEach((match) => {
      const fraction = (match[3] || '').padEnd(3, '0');
      parsedLines.push({
        time: Number(match[1]) * 60 + Number(match[2]) + Number(fraction) / 1000,
        text
      });
    });
  });

  return parsedLines.sort((first, second) => first.time - second.time);
}

function renderLyrics(lyrics) {
  syncedLines = parseLyrics(lyrics);
  lyricsContent.replaceChildren();

  if (!syncedLines.length) {
      lyricsNotice.hidden = false;
    lyricsContent.textContent = lyrics;
    return;
  }

    lyricsNotice.hidden = true;
  syncedLines.forEach((line) => {
    const lineElement = document.createElement('div');
    lineElement.className = 'lyrics-line';
    lineElement.textContent = line.text || '♪';
    lyricsContent.appendChild(lineElement);
    line.element = lineElement;
  });
}

function updateActiveLyric() {
  if (!streamIsActive || !syncedLines.length || !songStartedAt) return;

  const elapsed = performance.now() / 1000 - songStartedAt;
  let activeIndex = -1;

  syncedLines.forEach((line, index) => {
    if (line.time <= elapsed) activeIndex = index;
  });

  syncedLines.forEach((line, index) => {
    line.element.classList.toggle('is-active', index === activeIndex);
  });

  if (activeIndex >= 0 && activeIndex !== activeLyricIndex && !mobilePlayerViewChosen) {
    syncedLines[activeIndex].element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  activeLyricIndex = activeIndex;
}

function updateLyrics(data) {
  const lyrics = getLyrics(data);
  const song = data?.now_playing?.song;
  const nowPlaying = data?.now_playing;
  const songName = [song?.artist, song?.title].filter(Boolean).join(' - ');
  const hasLyrics = Boolean(lyrics);
  const songId = song?.id || songName;

  document.body.classList.toggle('has-lyrics', hasLyrics);
  lyricsPanel.setAttribute('aria-hidden', String(!hasLyrics));

  if (!hasLyrics) {
    lyricsSong.textContent = '';
    lyricsContent.replaceChildren();
      lyricsNotice.hidden = true;
    document.body.classList.remove('mobile-lyrics-expanded');
    document.body.classList.remove('mobile-lyrics-revealed');
    document.body.classList.remove('synced-lyrics');
    lyricsToggle.setAttribute('aria-expanded', 'false');
    lastLyricsWereSynced = false;
    mobilePlayerViewChosen = false;
    resetMobilePlayerPosition();
    syncedLines = [];
    currentSongId = '';
    activeLyricIndex = -1;
    return;
  }

  lyricsSong.textContent = songName;

  if (songId !== currentSongId) {
    currentSongId = songId;
    mobilePlayerViewChosen = false;
    songStartedAt = performance.now() / 1000
      - Number(nowPlaying?.elapsed || 0)
      + LYRICS_SYNC_OFFSET_SECONDS;
    renderLyrics(lyrics);

    const lyricsAreSynced = syncedLines.length > 0;
    document.body.classList.toggle('synced-lyrics', lyricsAreSynced);
    if (window.matchMedia('(max-width: 56.1875rem)').matches) {
      document.body.classList.toggle('mobile-lyrics-revealed', lyricsAreSynced);
      lyricsToggle.setAttribute('aria-expanded', String(lyricsAreSynced));
      if (!lyricsAreSynced || lastLyricsWereSynced !== lyricsAreSynced) {
        resetMobilePlayerPosition();
      }
    }
    lastLyricsWereSynced = lyricsAreSynced;
  }

  if (syncedLines.length) {
    const elapsed = Number(nowPlaying?.elapsed);
    if (Number.isFinite(elapsed)) {
      songStartedAt = performance.now() / 1000
        - elapsed
        + LYRICS_SYNC_OFFSET_SECONDS;
    }
  }

  updateActiveLyric();
}

async function fetchLyrics() {
  if ((!streamIsActive || lyricsRadio.paused) && hasFetchedLyrics) return;

  try {
    const response = await fetch(`${lyricsApi}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;

    const data = await response.json();
    hasFetchedLyrics = true;
    updateLyrics(data);
  } catch (error) {
    console.log('Lyrics update failed:', error);
  }
}

function updateMobileLyricsVisibility() {
  const isMobile = window.matchMedia('(max-width: 56.1875rem)').matches;
  const userScrolledTowardPlayer = isMobile
    && lastMobileScrollPosition > 48
    && window.scrollY < lastMobileScrollPosition - 2;

  if (userScrolledTowardPlayer) {
    mobilePlayerViewChosen = true;
  }
  const isRevealed = isMobile && window.scrollY > 48;
  document.body.classList.toggle('mobile-lyrics-revealed', isRevealed);
  lyricsToggle.setAttribute('aria-expanded', String(isRevealed));
  lastMobileScrollPosition = window.scrollY;
}

function handleMobileWheel(event) {
  if (window.matchMedia('(max-width: 56.1875rem)').matches && event.deltaY < 0) {
    mobilePlayerViewChosen = true;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}

function handleMobileTouchStart(event) {
  if (window.matchMedia('(max-width: 56.1875rem)').matches) {
    mobileTouchStartY = event.touches[0].clientY;
  }
}

function handleMobileTouchEnd(event) {
  const touchEndY = event.changedTouches[0].clientY;
  const movedDown = touchEndY - mobileTouchStartY > 24;

  if (window.matchMedia('(max-width: 56.1875rem)').matches && movedDown && window.scrollY > 48) {
    mobilePlayerViewChosen = true;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}

function resetMobilePlayerPosition() {
  if (!window.matchMedia('(max-width: 56.1875rem)').matches) return;
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  requestAnimationFrame(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  });
}

function setStreamPlaybackState(isActive) {
  streamIsActive = isActive && !lyricsRadio.paused;
  if (streamIsActive) fetchLyrics();
}

if (window.matchMedia('(max-width: 56.1875rem)').matches) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
}

fetchLyrics();
setInterval(fetchLyrics, 15000);
setInterval(() => {
  if (!lyricsRadio.paused) updateActiveLyric();
}, 250);
lyricsRadio.addEventListener('play', () => setStreamPlaybackState(true));
lyricsRadio.addEventListener('playing', () => setStreamPlaybackState(true));
lyricsRadio.addEventListener('canplay', () => setStreamPlaybackState(true));
lyricsRadio.addEventListener('pause', () => setStreamPlaybackState(false));
lyricsRadio.addEventListener('waiting', () => setStreamPlaybackState(false));
lyricsRadio.addEventListener('stalled', () => setStreamPlaybackState(false));
lyricsRadio.addEventListener('error', () => setStreamPlaybackState(false));
lyricsRadio.addEventListener('abort', () => setStreamPlaybackState(false));
window.addEventListener('scroll', updateMobileLyricsVisibility, { passive: true });
window.addEventListener('resize', updateMobileLyricsVisibility);
window.addEventListener('wheel', handleMobileWheel, { passive: true });
window.addEventListener('touchstart', handleMobileTouchStart, { passive: true });
window.addEventListener('touchend', handleMobileTouchEnd, { passive: true });
updateMobileLyricsVisibility();
