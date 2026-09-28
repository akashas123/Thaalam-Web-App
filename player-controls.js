const controlsRadio =
  document.getElementById('radio');

const songInfoButton =
  document.getElementById('songInfoButton');

const songInfoDialog =
  document.getElementById('songInfoDialog');

const songInfoArt =
  document.getElementById('songInfoArt');

const songInfoTrack =
  document.getElementById('songInfoTrack');

const songInfoArtist =
  document.getElementById('songInfoArtist');

const songInfoDetails =
  document.getElementById('songInfoDetails');

const songInfoBackground =
  document.getElementById('songInfoBackground');

const songInfoWikiLink =
  document.getElementById('songInfoWikiLink');

const sleepTimerButton =
  document.getElementById('sleepTimerButton');

const sleepTimerDialog =
  document.getElementById('sleepTimerDialog');

const sleepTimerStatus =
  document.getElementById('sleepTimerStatus');

const cancelSleepTimerButton =
  document.getElementById('cancelSleepTimer');

const thumbsDownButton =
  document.getElementById('thumbsDownButton');

const thumbsUpButton =
  document.getElementById('thumbsUpButton');

let sleepTimerDeadline = 0;
let sleepTimerInterval = 0;
let sleepTimerDuration = 0;
let itunesRequestId = 0;
let currentRatingTrackKey = '';
let feedbackTimeout = 0;

let likeFeedbackShown = false;
let dislikeFeedbackShown = false;

const itunesTrackCache =
  new Map();

const prefetchingSongInfo =
  new Set();

const RATING_STORAGE_KEY =
  'thaalam24x7-ratings';

const SONG_INFO_STORAGE_KEY =
  'thaalam24x7-song-info-v1';

const SONG_INFO_CACHE_LIMIT = 100;

const SLEEP_TIMER_STORAGE_KEY =
  'thaalam24x7-sleep-timer';

const SLEEP_TIMER_DURATION_KEY =
  'thaalam24x7-sleep-timer-duration';

function openDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (
    typeof dialog.showModal ===
    'function'
  ) {
    dialog.showModal();
  }
}

function showSongInfo(
  track,
  artist,
  details
) {
  songInfoTrack.textContent =
    track || '';

  songInfoArtist.textContent =
    artist || '';

  songInfoDetails.textContent =
    details || '';

  songInfoTrack.hidden =
    !track;

  songInfoArtist.hidden =
    !artist;

  songInfoDetails.hidden =
    !details;
}

function normalizeStorageText(
  value
) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getTrackRatingKey(
  song
) {
  if (!song) {
    return '';
  }

  const title =
    normalizeStorageText(
      song.title
    );

  const artist =
    normalizeStorageText(
      song.artist
    );

  if (!title && !artist) {
    return '';
  }

  return `${title}|${artist}`;
}

function getStoredSongInfo(key) {
  if (!key) return null;

  try {
    const cache = JSON.parse(
      localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}'
    );
    return cache[key] || null;
  } catch {
    return null;
  }
}

function saveStoredSongInfo(key, entry) {
  if (!key || !entry) return;

  try {
    const cache = JSON.parse(
      localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}'
    );
    cache[key] = { ...cache[key], ...entry, savedAt: Date.now() };

    const oldestKeys = Object.keys(cache)
      .sort((first, second) =>
        (cache[first]?.savedAt || 0) - (cache[second]?.savedAt || 0)
      );
    while (oldestKeys.length > SONG_INFO_CACHE_LIMIT) {
      delete cache[oldestKeys.shift()];
    }

    localStorage.setItem(
      SONG_INFO_STORAGE_KEY,
      JSON.stringify(cache)
    );
  } catch {
    // Song information still works if storage is unavailable or full.
  }
}

function showSongInfoBackground(background) {
  if (!background?.url) {
    songInfoBackground.textContent = '';
    songInfoBackground.hidden = true;
    songInfoWikiLink.hidden = true;
    return;
  }

  songInfoBackground.textContent = background.summary || '';
  songInfoBackground.hidden = !background.summary;
  songInfoWikiLink.href = background.url;
  songInfoWikiLink.textContent = `Source: Wikipedia - ${background.title}`;
  songInfoWikiLink.hidden = false;
}

function getStoredRatings() {
  try {
    const stored =
      localStorage.getItem(
        RATING_STORAGE_KEY
      );

    if (!stored) {
      return {};
    }

    const parsed =
      JSON.parse(stored);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    return parsed;

  } catch {
    return {};
  }
}

function saveStoredRatings(
  ratings
) {
  try {
    localStorage.setItem(
      RATING_STORAGE_KEY,
      JSON.stringify(ratings)
    );

    return true;

  } catch {
    return false;
  }
}

function clearRatingSelection() {
  if (thumbsDownButton) {
    thumbsDownButton.classList.remove(
      'rating-selected'
    );

    thumbsDownButton.setAttribute(
      'aria-pressed',
      'false'
    );
  }

  if (thumbsUpButton) {
    thumbsUpButton.classList.remove(
      'rating-selected'
    );

    thumbsUpButton.setAttribute(
      'aria-pressed',
      'false'
    );
  }
}

function applyStoredRating(
  value
) {
  clearRatingSelection();

  if (
    value === 'up' &&
    thumbsUpButton
  ) {
    thumbsUpButton.classList.add(
      'rating-selected'
    );

    thumbsUpButton.setAttribute(
      'aria-pressed',
      'true'
    );
  }

  if (
    value === 'down' &&
    thumbsDownButton
  ) {
    thumbsDownButton.classList.add(
      'rating-selected'
    );

    thumbsDownButton.setAttribute(
      'aria-pressed',
      'true'
    );
  }
}

function updateStoredRatingForCurrentSong(
  song
) {
  const key =
    getTrackRatingKey(song);

  currentRatingTrackKey =
    key;

  if (!key) {
    clearRatingSelection();
    return;
  }

  const ratings =
    getStoredRatings();

  const savedRating =
    ratings[key] === 'up' ||
    ratings[key] === 'down'
      ? ratings[key]
      : null;

  applyStoredRating(
    savedRating
  );
}

window.updateStoredRatingForCurrentSong =
  updateStoredRatingForCurrentSong;

function setStoredRating(
  value
) {
  if (!currentRatingTrackKey) {
    return false;
  }

  const ratings =
    getStoredRatings();

  const existing =
    ratings[
      currentRatingTrackKey
    ] || null;

  if (existing === value) {
    delete ratings[
      currentRatingTrackKey
    ];

    saveStoredRatings(
      ratings
    );

    applyStoredRating(
      null
    );

    return false;
  }

  ratings[
    currentRatingTrackKey
  ] = value;

  const saved =
    saveStoredRatings(
      ratings
    );

  if (!saved) {
    return false;
  }

  applyStoredRating(
    value
  );

  return true;
}

function selectRating(
  button,
  value
) {
  if (
    !button ||
    !currentRatingTrackKey
  ) {
    return false;
  }

  return setStoredRating(
    value
  );
}

function showSongFeedback(
  message
) {
  const albumArtCard =
    document.querySelector(
      '.album-art-card'
    );

  if (!albumArtCard) {
    return;
  }

  let feedback =
    document.getElementById(
      'songFeedback'
    );

  if (!feedback) {
    feedback =
      document.createElement(
        'div'
      );

    feedback.id =
      'songFeedback';

    feedback.className =
      'song-feedback';

    albumArtCard.appendChild(
      feedback
    );
  }

  clearTimeout(
    feedbackTimeout
  );

  feedback.textContent =
    message;

  feedback.classList.remove(
    'show'
  );

  requestAnimationFrame(() => {
    feedback.classList.add(
      'show'
    );
  });

  feedbackTimeout =
    window.setTimeout(() => {
      feedback.classList.remove(
        'show'
      );
    }, 2200);
}

function refreshCurrentRating() {
  const song =
    window.latestNowPlayingData?.now_playing?.song ||
    window.currentNowPlayingSong;

  updateStoredRatingForCurrentSong(song || null);
}

function updateSongInfo() {
  const albumArtImage =
    document.getElementById(
      'albumArtImg'
    );

  songInfoArt.src =
    albumArtImage?.currentSrc ||
    albumArtImage?.src ||
    'album-placeholder.svg?v=2';

  showSongInfo(
    '',
    '',
    ''
  );

  songInfoBackground.textContent =
    '';

  songInfoBackground.hidden =
    true;

  songInfoWikiLink.hidden =
    true;

  const song = window.currentNowPlayingSong;
  if (!song?.title || !song?.artist) {
    showSongInfo('', '', 'Track details are unavailable.');
    return;
  }

  updateStoredRatingForCurrentSong(song);
  const cached = getStoredSongInfo(getTrackRatingKey(song));
  const fallbackDetails = [
    `Album: ${song.album || 'N/A'}`,
    'Release date: N/A',
    'Genre: N/A',
    'Duration: N/A'
  ].join('\n');

  showSongInfo(
    cached?.track || song.title,
    cached?.artist || song.artist,
    cached?.details || fallbackDetails
  );
  showSongInfoBackground(cached?.background);
}

async function prefetchSongInfo(song) {
  if (!song?.title || !song?.artist) return;

  const cacheKey = getTrackRatingKey(song);
  if (!cacheKey) return;

  const cached = getStoredSongInfo(cacheKey);
  if (cached?.track && cached?.artist && cached?.details) return;
  if (prefetchingSongInfo.has(cacheKey)) return;

  prefetchingSongInfo.add(cacheKey);
  const fallbackDetails = [
    `Album: ${song.album || 'N/A'}`,
    'Release date: N/A',
    'Genre: N/A',
    'Duration: N/A'
  ].join('\n');

  const wikipediaRequest = cached?.wikiChecked
    ? Promise.resolve(cached.background || null)
    : fetchWikipediaSongBackground(song).catch(() => null);

  try {
    const musicData = await searchItunes(`${song.artist} ${song.title}`);
    const normalize = (value) => value
      ?.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || '';

    const requestedTitle = normalize(song.title);
    const requestedArtist = normalize(song.artist.split(',')[0]);
    const exactTitleMatches = musicData.results?.filter((track) =>
      normalize(track.trackName) === requestedTitle
    ) || [];
    const match = exactTitleMatches.find((recording) =>
      normalize(recording.artistName).includes(requestedArtist)
    ) || exactTitleMatches[0];

    let entry = {
      track: song.title,
      artist: song.artist,
      details: fallbackDetails
    };

    if (match) {
      const releaseDate = match.releaseDate
        ? new Date(match.releaseDate).toLocaleDateString()
        : 'N/A';
      const duration = match.trackTimeMillis
        ? `${Math.floor(match.trackTimeMillis / 60000)}:${String(
            Math.floor(match.trackTimeMillis / 1000) % 60
          ).padStart(2, '0')}`
        : 'N/A';

      entry = {
        track: match.trackName || song.title,
        artist: match.artistName || song.artist,
        details: [
          `Album: ${match.collectionName || song.album || 'N/A'}`,
          `Release date: ${releaseDate}`,
          `Genre: ${match.primaryGenreName || 'N/A'}`,
          `Duration: ${duration}`
        ].join('\n')
      };
    }

    saveStoredSongInfo(cacheKey, entry);
  } catch {
    saveStoredSongInfo(cacheKey, {
      track: song.title,
      artist: song.artist,
      details: fallbackDetails
    });
  }

  const background = await wikipediaRequest;
  saveStoredSongInfo(cacheKey, {
    background,
    wikiChecked: true
  });
  prefetchingSongInfo.delete(cacheKey);

  const currentSongKey = getTrackRatingKey(window.currentNowPlayingSong);
  if (songInfoDialog?.open && currentSongKey === cacheKey) {
    updateSongInfo();
  }
}

async function fetchWikipediaSongBackground(
  song
) {
  const artist =
    song.artist
      .split(',')[0]
      .trim();

  const search =
    new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch:
        `"${song.title}" ${artist} song`,
      srlimit: '5',
      format: 'json',
      origin: '*'
    });

  const searchResponse =
    await fetch(
      `https://en.wikipedia.org/w/api.php?${search}`
    );

  if (!searchResponse.ok) {
    throw new Error(
      'Wikipedia search failed.'
    );
  }

  const searchData =
    await searchResponse.json();

  const normalize =
    (value) =>
      value
        ?.normalize('NFKD')
        .replace(
          /[\u0300-\u036f]/g,
          ''
        )
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ''
        ) || '';

  const normalizedTitle =
    normalize(
      song.title
    );

  const article =
    searchData.query
      ?.search
      ?.find(
        (result) =>
          normalize(
            result.title
          ).startsWith(
            normalizedTitle
          )
      );

  if (!article) {
    return null;
  }

  const summaryQuery =
    new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      pageids: String(
        article.pageid
      ),
      format: 'json',
      origin: '*'
    });

  const summaryResponse =
    await fetch(
      `https://en.wikipedia.org/w/api.php?${summaryQuery}`
    );

  if (!summaryResponse.ok) {
    throw new Error(
      'Wikipedia summary failed.'
    );
  }

  const summaryData =
    await summaryResponse.json();

  const page =
    summaryData.query
      ?.pages?.[
        article.pageid
      ];

  return page?.extract
    ? {
        title: page.title,
        summary: page.extract,
        url:
          `https://en.wikipedia.org/?curid=${article.pageid}`
      }
    : null;
}

window.addEventListener('thaalam:nowplaying', (event) => {
  const song = event.detail?.now_playing?.song;
  updateStoredRatingForCurrentSong(song || null);
  if (!song) return;
  void prefetchSongInfo(song);
});

if (window.latestNowPlayingData?.now_playing?.song) {
  const currentSong = window.latestNowPlayingData.now_playing.song;
  updateStoredRatingForCurrentSong(currentSong);
  void prefetchSongInfo(currentSong);
} else if (window.latestNowPlayingData) {
  updateStoredRatingForCurrentSong(null);
}

function searchItunes(
  term
) {
  const cacheKey =
    term.toLowerCase();

  if (
    itunesTrackCache.has(
      cacheKey
    )
  ) {
    return Promise.resolve(
      itunesTrackCache.get(
        cacheKey
      )
    );
  }

  return new Promise(
    (
      resolve,
      reject
    ) => {
      const callbackName =
        `thaalamItunesCallback${++itunesRequestId}`;

      const query =
        new URLSearchParams({
          term,
          entity: 'song',
          limit: '15',
          callback: callbackName
        });

      const script =
        document.createElement(
          'script'
        );

      let finished =
        false;

      const timeout =
        window.setTimeout(
          () => {
            finish(
              new Error(
                'iTunes lookup timed out.'
              )
            );
          },
          8000
        );

      function finish(
        error,
        data
      ) {
        if (finished) {
          return;
        }

        finished = true;

        window.clearTimeout(
          timeout
        );

        delete window[
          callbackName
        ];

        script.remove();

        if (error) {
          reject(error);
          return;
        }

        itunesTrackCache.set(
          cacheKey,
          data
        );

        resolve(data);
      }

      window[callbackName] =
        (data) =>
          finish(
            null,
            data
          );

      script.onerror =
        () =>
          finish(
            new Error(
              'iTunes track details are unavailable.'
            )
          );

      script.src =
        `https://itunes.apple.com/search?${query}`;

      document.head.appendChild(
        script
      );
    }
  );
}

function getStoredSleepTimer() {
  try {
    const stored =
      localStorage.getItem(
        SLEEP_TIMER_STORAGE_KEY
      );

    if (!stored) {
      return 0;
    }

    const deadline =
      Number(stored);

    if (
      !Number.isFinite(deadline) ||
      deadline <= Date.now()
    ) {
      localStorage.removeItem(
        SLEEP_TIMER_STORAGE_KEY
      );

      return 0;
    }

    return deadline;

  } catch {
    return 0;
  }
}

function saveStoredSleepTimer(
  deadline
) {
  try {
    localStorage.setItem(
      SLEEP_TIMER_STORAGE_KEY,
      String(deadline)
    );
  } catch {
  }
}

function removeStoredSleepTimer() {
  try {
    localStorage.removeItem(
      SLEEP_TIMER_STORAGE_KEY
    );
  } catch {
  }

  try {
    localStorage.removeItem(
      SLEEP_TIMER_DURATION_KEY
    );
  } catch {
  }
}

function updateSleepTimerSelection(progress = 0) {
  sleepTimerDialog
    ?.querySelectorAll('[data-minutes]')
    .forEach((button) => {
      const selected =
        sleepTimerDuration > 0 &&
        Number(button.dataset.minutes) === sleepTimerDuration;

      button.classList.toggle('timer-option-active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.style.setProperty(
        '--timer-progress',
        selected ? `${Math.max(0, Math.min(100, progress))}%` : '0%'
      );
    });
}

function stopSleepTimer(
  clearStorage = true
) {
  window.clearInterval(
    sleepTimerInterval
  );

  sleepTimerInterval = 0;
  sleepTimerDeadline = 0;
  sleepTimerDuration = 0;
  updateSleepTimerSelection();

  if (clearStorage) {
    removeStoredSleepTimer();
  }

  sleepTimerStatus.textContent =
    '';

  cancelSleepTimerButton.hidden =
    true;

  sleepTimerButton.classList.remove(
    'timer-active'
  );

  sleepTimerButton.setAttribute(
    'aria-pressed',
    'false'
  );

  sleepTimerButton.title =
    'Sleep timer';
}

function refreshSleepTimerStatus() {
  if (!sleepTimerDeadline) {
    return;
  }

  const remaining =
    Math.max(
      0,
      Math.ceil(
        (
          sleepTimerDeadline -
          Date.now()
        ) / 1000
      )
    );

  if (remaining <= 0) {
    stopSleepTimer();

    controlsRadio.pause();

    sleepTimerStatus.textContent =
      'Timer complete. Playback paused.';

    openDialog(
      sleepTimerDialog
    );

    return;
  }

  const totalDuration = sleepTimerDuration * 60;
  updateSleepTimerSelection(
    totalDuration > 0
      ? (remaining / totalDuration) * 100
      : 0
  );

  const minutes =
    Math.floor(
      remaining / 60
    );

  const seconds =
    remaining % 60;

  const formatted =
    `${minutes}:${String(
      seconds
    ).padStart(
      2,
      '0'
    )}`;

  sleepTimerStatus.textContent =
    `Playback will pause in ${formatted}.`;

  sleepTimerButton.title =
    `Sleep timer: ${formatted} remaining`;
}

function startSleepTimer(
  minutes
) {
  stopSleepTimer();

  sleepTimerDuration = minutes;
  sleepTimerDeadline =
    Date.now() +
    minutes * 60 * 1000;

  saveStoredSleepTimer(
    sleepTimerDeadline
  );

  try {
    localStorage.setItem(
      SLEEP_TIMER_DURATION_KEY,
      String(minutes)
    );
  } catch {
  }

  updateSleepTimerSelection();

  sleepTimerButton.classList.add(
    'timer-active'
  );

  sleepTimerButton.setAttribute(
    'aria-pressed',
    'true'
  );

  cancelSleepTimerButton.hidden =
    false;

  refreshSleepTimerStatus();

  sleepTimerInterval =
    window.setInterval(
      refreshSleepTimerStatus,
      1000
    );

  sleepTimerDialog.close();
}

function restoreSleepTimer() {
  const deadline =
    getStoredSleepTimer();

  if (!deadline) {
    return;
  }

  sleepTimerDeadline =
    deadline;

  try {
    sleepTimerDuration = Number(
      localStorage.getItem(SLEEP_TIMER_DURATION_KEY)
    ) || 0;
  } catch {
    sleepTimerDuration = 0;
  }

  const remainingSeconds = Math.max(
    0,
    Math.ceil((deadline - Date.now()) / 1000)
  );
  updateSleepTimerSelection(
    sleepTimerDuration > 0
      ? (remainingSeconds / (sleepTimerDuration * 60)) * 100
      : 0
  );

  sleepTimerButton.classList.add(
    'timer-active'
  );

  sleepTimerButton.setAttribute(
    'aria-pressed',
    'true'
  );

  cancelSleepTimerButton.hidden =
    false;

  refreshSleepTimerStatus();

  if (sleepTimerDeadline) {
    sleepTimerInterval =
      window.setInterval(
        refreshSleepTimerStatus,
        1000
      );
  }
}

songInfoButton?.addEventListener(
  'click',
  () => {
    updateSongInfo();

    openDialog(
      songInfoDialog
    );
  }
);

sleepTimerButton?.addEventListener(
  'click',
  () => {
    openDialog(
      sleepTimerDialog
    );
  }
);

sleepTimerDialog
  ?.querySelectorAll(
    '[data-minutes]'
  )
  .forEach(
    (button) => {
      button.addEventListener(
        'click',
        () => {
          startSleepTimer(
            Number(
              button.dataset.minutes
            )
          );
        }
      );
    }
  );

cancelSleepTimerButton?.addEventListener(
  'click',
  () => {
    stopSleepTimer();

    sleepTimerDialog.close();
  }
);

if (thumbsUpButton) {
  thumbsUpButton.setAttribute(
    'aria-pressed',
    'false'
  );

  thumbsUpButton.addEventListener(
    'click',
    () => {
      if (!currentRatingTrackKey) {
        refreshCurrentRating();
      }

      const triggered =
        selectRating(
          thumbsUpButton,
          'up'
        );

      if (
        triggered &&
        !likeFeedbackShown
      ) {
        likeFeedbackShown =
          true;

        showSongFeedback(
          'Likes influences our charts'
        );
      }
    }
  );
}

if (thumbsDownButton) {
  thumbsDownButton.setAttribute(
    'aria-pressed',
    'false'
  );

  thumbsDownButton.addEventListener(
    'click',
    () => {
      if (!currentRatingTrackKey) {
        refreshCurrentRating();
      }

      const triggered =
        selectRating(
          thumbsDownButton,
          'down'
        );

      if (
        triggered &&
        !dislikeFeedbackShown
      ) {
        dislikeFeedbackShown =
          true;

        showSongFeedback(
          'Tuning, promo factors may still apply'
        );
      }
    }
  );
}

controlsRadio?.addEventListener(
  'ended',
  () => {
    stopSleepTimer();
  }
);

restoreSleepTimer();

window.setTimeout(refreshCurrentRating, 300);
