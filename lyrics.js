const lyricsPanel = document.getElementById('lyricsPanel');
const lyricsToggle = document.getElementById('lyricsToggle');
const lyricsSong = document.getElementById('lyricsSong');
const lyricsContent = document.getElementById('lyricsContent');
const lyricsNotice = document.getElementById('lyricsNotice');
const lyricsRadio = document.getElementById('radio');

const lyricsApi =
  'https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7';

const lrclibApi =
  'https://lrclib.net/api';

const LYRICS_SYNC_OFFSET_SECONDS = 2;

let syncedLines = [];
let currentSongId = '';
let songStartedAt = 0;
let activeLyricIndex = -1;
let lastLyricsWereSynced = false;
let hasFetchedLyrics = false;
let streamIsActive = false;
let playbackStartedOnMobile = false;
let mobilePlayerViewChosen = false;
let mobileTouchStartY = 0;
let lyricsLookupSongId = '';
let lyricsLookupResult = '';
let lyricsLookupRequestId = 0;
let lyricScrollFrame = 0;

const lrclibCache = new Map();

function normalizeTrackTitle(value) {
  return value
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || '';
}

async function fetchLrclibLyrics(song) {
  if (!song?.artist || !song?.title) {
    return '';
  }

  const cacheKey =
    `${song.artist.toLowerCase()}|${song.title.toLowerCase()}`;

  if (lrclibCache.has(cacheKey)) {
    return lrclibCache.get(cacheKey);
  }

  try {
    const search = new URLSearchParams({
      q: song.title
    });

    const response = await fetch(
      `${lrclibApi}/search?${search}`,
      {
        cache: 'default'
      }
    );

    if (!response.ok) {
      return '';
    }

    const matches = await response.json();

    const normalizedTitle =
      normalizeTrackTitle(song.title);

    const result = matches.find((match) =>
      normalizeTrackTitle(match.trackName) === normalizedTitle &&
      (match.syncedLyrics || match.plainLyrics)
    );

    const lyrics =
      result?.syncedLyrics ||
      result?.plainLyrics ||
      '';

    lrclibCache.set(cacheKey, lyrics);

    return lyrics;

  } catch (error) {
    console.log(
      'LRCLIB lyrics lookup failed:',
      error
    );

    return '';
  }
}

function getAzuraCastLyrics(song) {
  const lyrics = song?.lyrics;

  if (Array.isArray(lyrics)) {
    return lyrics.join('\n').trim();
  }

  return typeof lyrics === 'string'
    ? lyrics.trim()
    : '';
}

function parseLyrics(lyrics) {
  const lines =
    lyrics.split(/\r?\n/);

  const timestampPattern =
    /\[(\d{1,2}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;

  const parsedLines = [];

  lines.forEach((line) => {
    const timestamps =
      [...line.matchAll(timestampPattern)];

    const text =
      line.replace(timestampPattern, '').trim();

    timestamps.forEach((match) => {
      const fraction =
        (match[3] || '').padEnd(3, '0');

      parsedLines.push({
        time:
          Number(match[1]) * 60 +
          Number(match[2]) +
          Number(fraction) / 1000,
        text
      });
    });
  });

  return parsedLines.sort(
    (first, second) =>
      first.time - second.time
  );
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
    const lineElement =
      document.createElement('div');

    lineElement.className =
      'lyrics-line';

    lineElement.textContent =
      line.text || '♪';

    lyricsContent.appendChild(
      lineElement
    );

    line.element = lineElement;
  });
}

function updateActiveLyric() {
  if (
    !streamIsActive ||
    !syncedLines.length ||
    !songStartedAt
  ) {
    return;
  }

  const elapsed =
    performance.now() / 1000 -
    songStartedAt;

  let activeIndex = -1;

  syncedLines.forEach(
    (line, index) => {
      if (line.time <= elapsed) {
        activeIndex = index;
      }
    }
  );

  syncedLines.forEach(
    (line, index) => {
      line.element.classList.toggle(
        'is-active',
        index === activeIndex
      );
    }
  );

  if (
    activeIndex >= 0 &&
    activeIndex !== activeLyricIndex
  ) {
    if (
      window.matchMedia(
        '(max-width: 56.1875rem)'
      ).matches &&
      mobilePlayerViewChosen
    ) {
      mobilePlayerViewChosen = false;

      lyricsPanel.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }

    smoothlyRevealLyric(
      syncedLines[activeIndex].element
    );
  }

  activeLyricIndex =
    activeIndex;
}

function smoothlyRevealLyric(lineElement) {
  cancelAnimationFrame(
    lyricScrollFrame
  );

  const container =
    lyricsContent;

  const lineRect =
    lineElement.getBoundingClientRect();

  const start =
    container.scrollTop;

  const destination =
    Math.max(
      0,
      start +
      lineRect.top -
      container.getBoundingClientRect().top -
      (container.clientHeight -
        lineRect.height) / 2
    );

  const distance =
    destination - start;

  if (Math.abs(distance) < 2) {
    return;
  }

  const startTime =
    performance.now();

  const duration =
    Math.min(
      900,
      Math.max(
        450,
        Math.abs(distance) * 1.2
      )
    );

  function animateScroll(now) {
    if (!streamIsActive) {
      lyricScrollFrame = 0;
      return;
    }

    const progress =
      Math.min(
        1,
        (now - startTime) /
        duration
      );

    const easedProgress =
      progress < 0.5
        ? 4 *
          progress *
          progress *
          progress
        : 1 -
          Math.pow(
            -2 * progress + 2,
            3
          ) / 2;

    container.scrollTop =
      start +
      distance *
      easedProgress;

    if (progress < 1) {
      lyricScrollFrame =
        requestAnimationFrame(
          animateScroll
        );
    } else {
      lyricScrollFrame = 0;
    }
  }

  lyricScrollFrame =
    requestAnimationFrame(
      animateScroll
    );
}

function handleSongLyricsView(
  lyricsAreSynced
) {
  if (
    !window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches
  ) {
    return;
  }

  if (
    lyricsAreSynced &&
    streamIsActive &&
    !lyricsRadio.paused
  ) {
    document.body.classList.add(
      'mobile-lyrics-expanded'
    );

    lyricsToggle.setAttribute(
      'aria-expanded',
      'true'
    );

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lyricsPanel.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      });
    });

    return;
  }

  document.body.classList.remove(
    'mobile-lyrics-expanded'
  );

  lyricsToggle.setAttribute(
    'aria-expanded',
    'false'
  );

  resetMobilePlayerPosition();
}

function updateLyrics(
  data,
  refreshCurrentSong = false
) {
  const song =
    data?.now_playing?.song;

  const lyrics =
    lyricsLookupResult ||
    getAzuraCastLyrics(song);

  const nowPlaying =
    data?.now_playing;

  const songName =
    [
      song?.artist,
      song?.title
    ]
      .filter(Boolean)
      .join(' - ');

  const hasLyrics =
    Boolean(lyrics);

  const songId =
    song?.id ||
    songName;

  document.body.classList.toggle(
    'has-lyrics',
    hasLyrics
  );

  lyricsPanel.setAttribute(
    'aria-hidden',
    String(!hasLyrics)
  );

  if (!hasLyrics) {
    lyricsSong.textContent = '';

    lyricsContent.replaceChildren();

    lyricsNotice.hidden = true;

    document.body.classList.remove(
      'mobile-lyrics-expanded'
    );

    document.body.classList.remove(
      'synced-lyrics'
    );

    lyricsToggle.setAttribute(
      'aria-expanded',
      'false'
    );

    lastLyricsWereSynced = false;

    resetMobilePlayerPosition();

    syncedLines = [];

    currentSongId = '';

    activeLyricIndex = -1;

    return;
  }

  lyricsSong.textContent =
    songName;

  const songChanged =
    songId !== currentSongId;

  if (
    songChanged ||
    refreshCurrentSong
  ) {
    if (songChanged) {
      currentSongId =
        songId;

      songStartedAt =
        performance.now() / 1000 -
        Number(
          nowPlaying?.elapsed || 0
        ) +
        LYRICS_SYNC_OFFSET_SECONDS;
    }

    renderLyrics(lyrics);

    const lyricsAreSynced =
      syncedLines.length > 0;

    const lyricsSyncStatusChanged =
      lastLyricsWereSynced !==
      lyricsAreSynced;

    document.body.classList.toggle(
      'synced-lyrics',
      lyricsAreSynced
    );

    lastLyricsWereSynced =
      lyricsAreSynced;

    if (
      songChanged ||
      lyricsSyncStatusChanged
    ) {
      handleSongLyricsView(
        lyricsAreSynced
      );
    }
  }

  if (syncedLines.length) {
    const elapsed =
      Number(
        nowPlaying?.elapsed
      );

    if (Number.isFinite(elapsed)) {
      songStartedAt =
        performance.now() / 1000 -
        elapsed +
        LYRICS_SYNC_OFFSET_SECONDS;
    }
  }

  updateActiveLyric();

  expandLyricsAfterPlaybackStarts();
}

async function fetchLyrics() {
  if (
    (!streamIsActive ||
      lyricsRadio.paused) &&
    hasFetchedLyrics
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        `${lyricsApi}?t=${Date.now()}`,
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    hasFetchedLyrics = true;

    const song =
      data?.now_playing?.song;

    const songId =
      song?.id ||
      [
        song?.artist,
        song?.title
      ]
        .filter(Boolean)
        .join(' - ');

    if (
      songId &&
      songId !== lyricsLookupSongId
    ) {
      lyricsLookupSongId =
        songId;

      const azuraCastLyrics =
        getAzuraCastLyrics(song);

      const azuraHasTimestamps =
        parseLyrics(
          azuraCastLyrics
        ).length > 0;

      lyricsLookupResult =
        azuraCastLyrics;

      const requestId =
        ++lyricsLookupRequestId;

      updateLyrics(data);

      if (azuraHasTimestamps) {
        console.info(
          'Using timestamped lyrics from AzuraCast.'
        );

        return;
      }

      console.info(
        'AzuraCast lyrics have no timestamps; checking LRCLIB.'
      );

      const lrclibLyrics =
        await fetchLrclibLyrics(
          song
        );

      if (
        requestId !==
        lyricsLookupRequestId
      ) {
        return;
      }

      lyricsLookupResult =
        lrclibLyrics ||
        azuraCastLyrics;

      updateLyrics(
        data,
        true
      );

      return;
    }

    updateLyrics(data);

  } catch (error) {
    console.log(
      'Lyrics update failed:',
      error
    );
  }
}

function updateMobileLyricsVisibility() {
  const isMobile =
    window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches;

  const isExpanded =
    isMobile &&
    document.body.classList.contains(
      'mobile-lyrics-expanded'
    );

  lyricsToggle.setAttribute(
    'aria-expanded',
    String(isExpanded)
  );
}

function collapseMobileLyrics() {
  if (
    !window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches
  ) {
    return;
  }

  document.body.classList.remove(
    'mobile-lyrics-expanded'
  );

  resetMobilePlayerPosition();

  lyricsToggle.setAttribute(
    'aria-expanded',
    'false'
  );
}

function expandLyricsAfterPlaybackStarts() {
  if (
    !playbackStartedOnMobile ||
    !streamIsActive ||
    lyricsRadio.paused ||
    !document.body.classList.contains(
      'has-lyrics'
    ) ||
    !document.body.classList.contains(
      'synced-lyrics'
    )
  ) {
    return;
  }

  playbackStartedOnMobile = false;

  document.body.classList.add(
    'mobile-lyrics-expanded'
  );

  lyricsToggle.setAttribute(
    'aria-expanded',
    'true'
  );

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      lyricsPanel.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  });
}

function handleMobileWheel(event) {
  if (
    window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches &&
    event.deltaY < 0
  ) {
    mobilePlayerViewChosen = true;

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });
  }
}

function handleMobileTouchStart(event) {
  if (
    window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches
  ) {
    mobileTouchStartY =
      event.touches[0].clientY;
  }
}

function handleMobileTouchEnd(event) {
  const touchEndY =
    event.changedTouches[0].clientY;

  const movedDown =
    touchEndY -
      mobileTouchStartY >
    24;

  if (
    window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches &&
    movedDown &&
    window.scrollY > 48
  ) {
    mobilePlayerViewChosen = true;

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });
  }
}

function resetMobilePlayerPosition() {
  if (
    !window.matchMedia(
      '(max-width: 56.1875rem)'
    ).matches
  ) {
    return;
  }

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto'
  });

  requestAnimationFrame(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto'
    });
  });
}

function setStreamPlaybackState(
  isActive
) {
  const wasActive =
    streamIsActive;

  streamIsActive =
    isActive &&
    !lyricsRadio.paused;

  if (streamIsActive) {
    if (!wasActive) {
      playbackStartedOnMobile =
        window.matchMedia(
          '(max-width: 56.1875rem)'
        ).matches;
    }

    fetchLyrics();

    expandLyricsAfterPlaybackStarts();

  } else {
    playbackStartedOnMobile =
      false;

    cancelAnimationFrame(
      lyricScrollFrame
    );

    lyricScrollFrame = 0;
  }
}

if (
  window.matchMedia(
    '(max-width: 56.1875rem)'
  ).matches
) {
  if (
    'scrollRestoration' in history
  ) {
    history.scrollRestoration =
      'manual';
  }

  window.scrollTo(0, 0);
}

fetchLyrics();

setInterval(
  fetchLyrics,
  15000
);

setInterval(() => {
  if (!lyricsRadio.paused) {
    updateActiveLyric();
  }
}, 250);

lyricsRadio.addEventListener(
  'play',
  () => setStreamPlaybackState(true)
);

lyricsRadio.addEventListener(
  'playing',
  () => setStreamPlaybackState(true)
);

lyricsRadio.addEventListener(
  'pause',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'waiting',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'stalled',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'error',
  () => setStreamPlaybackState(false)
);

lyricsRadio.addEventListener(
  'abort',
  () => setStreamPlaybackState(false)
);

window.addEventListener(
  'scroll',
  updateMobileLyricsVisibility,
  { passive: true }
);

window.addEventListener(
  'resize',
  updateMobileLyricsVisibility
);

window.addEventListener(
  'wheel',
  handleMobileWheel,
  { passive: true }
);

window.addEventListener(
  'touchstart',
  handleMobileTouchStart,
  { passive: true }
);

window.addEventListener(
  'touchend',
  handleMobileTouchEnd,
  { passive: true }
);

lyricsToggle.addEventListener(
  'click',
  collapseMobileLyrics
);

updateMobileLyricsVisibility();