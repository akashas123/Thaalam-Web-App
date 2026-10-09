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

const onDemandLikeButton =
  document.getElementById('onDemandLikeButton');

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

const RATING_DELETE_STORAGE_PREFIX =
  'thaalam24x7-rating-deletions:';

const SONG_INFO_STORAGE_KEY =
  'thaalam24x7-song-info-v1';

const SONG_INFO_CACHE_LIMIT = 500;

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

function hasUsableLiveArtist(
  song
) {
  const artist = String(
    song?.artist ?? ''
  ).trim();
  if (!artist) {
    return false;
  }
  return artist.toLowerCase() !==
    'unknown artist';
}

function hasUsableSongDetails(
  song,
  cachedOverride
) {
  if (!song?.title || !song?.artist) {
    return false;
  }

  let details = null;
  if (typeof cachedOverride === 'string') {
    details = cachedOverride;
  } else if (cachedOverride && typeof cachedOverride.details === 'string') {
    details = cachedOverride.details;
  } else {
    details = getStoredSongInfo(getTrackRatingKey(song))?.details || null;
  }

  // Unknown until the iTunes prefetch lands - leave the button as-is
  // so valid songs don't flicker disabled on every track change.
  if (!details) {
    return true;
  }

  if (details.includes('unavailable')) {
    return false;
  }

  const values = details
    .split('\n')
    .map((line) => {
      const separator = line.indexOf(':');
      return (separator === -1 ? line : line.slice(separator + 1)).trim().toLowerCase();
    })
    .filter(Boolean);

  if (!values.length) {
    return false;
  }

  return values.some((value) => value !== 'n/a' && value !== '-' && value !== 'unknown');
}

function setSongInfoButtonEnabled(
  enabled
) {
  if (!songInfoButton) {
    return;
  }

  songInfoButton.disabled = !enabled;
  songInfoButton.classList.toggle(
    'is-disabled',
    !enabled
  );
  songInfoButton.setAttribute(
    'aria-disabled',
    String(!enabled)
  );

  if (!enabled) {
    songInfoButton.removeAttribute(
      'title'
    );
  } else {
    songInfoButton.title =
      'Song information';
  }
}

function refreshSongInfoAvailability(
  song,
  cachedOverride
) {
  if (!songInfoButton) {
    return;
  }

  // Artist-gating lives in updateLiveActionAvailability - never re-enable
  // a button it deliberately disabled.
  const onDemandActive =
    Boolean(
      window.onDemandPlaybackActive
    ) ||
    Boolean(
      document.body?.classList?.contains(
        'on-demand-active'
      )
    );

  if (!onDemandActive && !hasUsableLiveArtist(song)) {
    return;
  }

  if (!song?.title || !song?.artist) {
    setSongInfoButtonEnabled(false);
    return;
  }

  let details = null;
  if (typeof cachedOverride === 'string') {
    details = cachedOverride;
  } else if (cachedOverride && typeof cachedOverride.details === 'string') {
    details = cachedOverride.details;
  } else {
    details = getStoredSongInfo(getTrackRatingKey(song))?.details || null;
  }

  // Still loading - keep current state.
  if (!details) {
    return;
  }

  setSongInfoButtonEnabled(hasUsableSongDetails(song, details));
}

function updateLiveActionAvailability(
  song
) {
  const onDemandActive =
    Boolean(
      window.onDemandPlaybackActive
    ) ||
    Boolean(
      document.body?.classList?.contains(
        'on-demand-active'
      )
    );

  if (onDemandActive) {
    // On-demand always has a real title/artist. Like/dislike stay enabled,
    // but the info button greys out when every detail is N/A.
    if (thumbsUpButton) {
      thumbsUpButton.disabled = false;
      thumbsUpButton.classList.remove('is-disabled');
      thumbsUpButton.setAttribute('aria-disabled', 'false');
      thumbsUpButton.title = 'Like';
    }

    if (thumbsDownButton) {
      thumbsDownButton.disabled = false;
      thumbsDownButton.classList.remove('is-disabled');
      thumbsDownButton.setAttribute('aria-disabled', 'false');
      thumbsDownButton.title = 'Dislike';
    }

    refreshSongInfoAvailability(song);

    return;
  }

  const actionable =
    hasUsableLiveArtist(song);

  [
    thumbsUpButton,
    thumbsDownButton
  ].forEach((button) => {
    if (!button) {
      return;
    }

    button.disabled = !actionable;
    button.classList.toggle(
      'is-disabled',
      !actionable
    );
    button.setAttribute(
      'aria-disabled',
      String(!actionable)
    );

    if (!actionable) {
      button.removeAttribute(
        'title'
      );
    } else if (
      button === thumbsUpButton
    ) {
      button.title = 'Like';
    } else {
      button.title = 'Dislike';
    }
  });

  // Info button follows its own rule: enabled when the artist is usable
  // AND at least one detail (album/date/genre/duration) is real data.
  if (songInfoButton) {
    if (!actionable) {
      setSongInfoButtonEnabled(false);
    } else {
      refreshSongInfoAvailability(song);
    }
  }

  if (!actionable) {
    clearRatingSelection();
  }
}

function getTrackRatingKey(
  song
) {
  if (!song) {
    return '';
  }

  const videoId = song.youtubeVideoId ||
    (typeof song.id === 'string' && /^[\w-]{11}$/.test(song.id) ? song.id : '');
  if (videoId && /^[\w-]{11}$/.test(videoId)) {
    return `youtube:${videoId}`;
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

function getRatingTrackDetails(trackKey) {
  const liveSong = window.latestNowPlayingData?.now_playing?.song || window.currentNowPlayingSong || null;
  const onDemandSong = (typeof window.getCurrentOnDemandSong === 'function'
    ? window.getCurrentOnDemandSong()
    : null) || null;
  const onDemandActive = Boolean(window.onDemandPlaybackActive) ||
    Boolean(document.body?.classList?.contains('on-demand-active'));
  // Live and on-demand both publish {title,artist,art,id}; catalog items use
  // {trackName,artistName,artworkUrl100,youtubeVideoId}. Accept both shapes.
  const song = (onDemandActive && onDemandSong?.trackName)
    ? {
      title: onDemandSong.trackName,
      artist: onDemandSong.artistName,
      album: onDemandSong.collectionName,
      art: onDemandSong.artworkUrl100,
      youtubeVideoId: onDemandSong.youtubeVideoId
    }
    : (liveSong?.title ? liveSong : null) || {};
  const rawTitle = song.title || song.trackName || '';
  const rawArtist = String(song.artist || song.artistName || '').replace(/\s-\sTopic$/i, '').trim();
  let videoId = song.youtubeVideoId || '';
  if (!videoId && typeof song.id === 'string' && /^[\w-]{11}$/.test(song.id)) videoId = song.id;
  if (!videoId && typeof trackKey === 'string' && trackKey.startsWith('youtube:')) {
    const candidate = trackKey.slice('youtube:'.length);
    if (/^[\w-]{11}$/.test(candidate)) videoId = candidate;
  }
  let artwork = song.art || song.artworkUrl100 || '';
  if (!artwork && trackKey) {
    try {
      const cached = JSON.parse(localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}')?.[trackKey];
      artwork = cached?.artworkUrl100 || cached?.artwork || '';
    } catch { /* Keep artwork empty; renderers fall back to YouTube thumbnails. */ }
  }
  if (!artwork && videoId) artwork = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return {
    title: String(rawTitle || '').trim(),
    artist: rawArtist,
    videoId,
    artwork: String(artwork || '').trim()
  };
}

function getPendingRatingDeletes() {
  const userId = window.getThaalamGoogleUserId?.() ||
    localStorage.getItem(`${RATING_STORAGE_KEY}-owner`) || 'anonymous';
  const key = `${RATING_DELETE_STORAGE_PREFIX}${userId}`;
  try {
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePendingRatingDeletes(deletions) {
  const userId = window.getThaalamGoogleUserId?.() ||
    localStorage.getItem(`${RATING_STORAGE_KEY}-owner`) || 'anonymous';
  try {
    localStorage.setItem(
      `${RATING_DELETE_STORAGE_PREFIX}${userId}`,
      JSON.stringify([...deletions])
    );
  } catch {
    // Cloud delete retries are best-effort if browser storage is unavailable.
  }
}

async function requestCloudRatings(method, body) {
  const token = window.getThaalamGoogleAccessToken?.();
  if (!token) return null;
  const response = await fetch('/api/ratings', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (response.status === 401) {
    sessionStorage.removeItem('thaalam.googleAccessToken');
    window.dispatchEvent(new Event('thaalam:auth-expired'));
    throw new Error('Google sign-in expired.');
  }
  if (response.status === 503) {
    window.dispatchEvent(new Event('thaalam:sync-unavailable'));
  }
  if (!response.ok) throw new Error(`Ratings sync failed (${response.status})`);
  return method === 'GET' ? response.json() : true;
}

async function persistRatingToCloud(trackKey, rating) {
  if (!trackKey) return;
  const deletions = getPendingRatingDeletes();
  if (rating) deletions.delete(trackKey);
  else deletions.add(trackKey);
  savePendingRatingDeletes(deletions);
  if (!window.getThaalamGoogleAccessToken?.()) return;
  const details = getRatingTrackDetails(trackKey);
  try {
    await requestCloudRatings(rating ? 'PUT' : 'DELETE', {
      trackKey,
      rating,
      ...details
    });
    if (!rating) deletions.delete(trackKey);
    savePendingRatingDeletes(deletions);
  } catch (error) {
    console.warn('Could not sync this rating to the account.', error);
  }
}

async function syncRatingsFromCloud() {
  const userId = window.getThaalamGoogleUserId?.();
  if (!window.getThaalamGoogleAccessToken?.() || !userId) return;
  try {
    const response = await requestCloudRatings('GET');
    const remoteRatings = {};
    for (const entry of response.ratings || []) {
      if (entry.track_key && (entry.rating === 'up' || entry.rating === 'down')) {
        remoteRatings[entry.track_key] = entry.rating;
      }
    }

    const pendingDeletes = getPendingRatingDeletes();
    if (pendingDeletes.size) {
      await requestCloudRatings('DELETE', { trackKeys: [...pendingDeletes] });
      for (const trackKey of pendingDeletes) {
        delete remoteRatings[trackKey];
        pendingDeletes.delete(trackKey);
      }
    }
    savePendingRatingDeletes(pendingDeletes);

    // Bring existing browser ratings into the account the first time it syncs.
    const ratingsOwnerKey = `${RATING_STORAGE_KEY}-owner`;
    const owner = localStorage.getItem(ratingsOwnerKey) || '';
    let localRatings = getStoredRatings();
    if (owner && owner !== userId) {
      localStorage.setItem(`${RATING_STORAGE_KEY}:${owner}`, JSON.stringify(localRatings));
      try {
        localRatings = JSON.parse(localStorage.getItem(`${RATING_STORAGE_KEY}:${userId}`) || '{}');
      } catch {
        localRatings = {};
      }
      saveStoredRatings(localRatings);
    }
    const localEntries = Object.entries(localRatings)
      .filter(([, rating]) => rating === 'up' || rating === 'down')
      .slice(0, 500);
    let songInfoCache = {};
    try { songInfoCache = JSON.parse(localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}'); } catch { songInfoCache = {}; }
    const uploads = [];
    for (const [trackKey, rating] of localEntries) {
      if (remoteRatings[trackKey]) continue;
      // Prefer the snapshot taken at like-time (has real title/artist/artwork).
      // The raw key alone is lossy: `youtube:ID` carries no names at all.
      const cached = songInfoCache?.[trackKey] || {};
      let [title = '', artist = ''] = trackKey.startsWith('youtube:')
        ? ['', '']
        : trackKey.split('|');
      title = cached.track || title;
      artist = cached.artist || artist;
      let videoId = trackKey.startsWith('youtube:') ? trackKey.slice('youtube:'.length) : '';
      if (!/^[\w-]{11}$/.test(videoId)) videoId = '';
      const artwork = cached.artworkUrl100 || cached.artwork || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
      uploads.push({ trackKey, rating, title, artist, videoId, artwork });
      remoteRatings[trackKey] = rating;
    }
    if (uploads.length) await requestCloudRatings('PUT', { ratings: uploads });

    saveStoredRatings({ ...localRatings, ...remoteRatings });
    localStorage.setItem(ratingsOwnerKey, userId);
    updateStoredRatingForCurrentSong(
      window.latestNowPlayingData?.now_playing?.song || window.currentNowPlayingSong || null
    );
  } catch (error) {
    console.warn('Could not sync account ratings.', error);
  }
}

window.addEventListener('thaalam:authenticated', syncRatingsFromCloud);
if (window.getThaalamGoogleAccessToken?.()) {
  void syncRatingsFromCloud();
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

  if (onDemandLikeButton) {
    onDemandLikeButton.classList.remove('rating-selected');
    onDemandLikeButton.setAttribute('aria-pressed', 'false');
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

  if (value === 'up' && onDemandLikeButton) {
    onDemandLikeButton.classList.add('rating-selected');
    onDemandLikeButton.setAttribute('aria-pressed', 'true');
    onDemandLikeButton.setAttribute('aria-label', 'Unlike song');
    onDemandLikeButton.title = 'Unlike song';
  } else if (onDemandLikeButton) {
    onDemandLikeButton.setAttribute('aria-label', 'Like song');
    onDemandLikeButton.title = 'Like song';
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
  updateLiveActionAvailability(
    song
  );

  const isLiveContext =
    !window.onDemandPlaybackActive &&
    !document.body?.classList?.contains(
      'on-demand-active'
    );

  if (
    isLiveContext &&
    !hasUsableLiveArtist(song)
  ) {
    currentRatingTrackKey = '';
    clearRatingSelection();
    return;
  }

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

  let savedRating = ratings[key];
  if ((!savedRating || (savedRating !== 'up' && savedRating !== 'down')) && key.startsWith('youtube:')) {
    const legacyKey = `${normalizeStorageText(song.title)}|${normalizeStorageText(song.artist)}`;
    const legacyRating = ratings[legacyKey];
    if (legacyRating === 'up' || legacyRating === 'down') {
      savedRating = legacyRating;
      ratings[key] = legacyRating;
      delete ratings[legacyKey];
      saveStoredRatings(ratings);
    }
  }
  if (savedRating !== 'up' && savedRating !== 'down') savedRating = null;

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

  const song =
    window.latestNowPlayingData?.now_playing?.song ||
    window.currentNowPlayingSong || null;

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

  // Snapshot the visible metadata alongside the rating key. The key alone
  // (especially `youtube:VIDEO_ID`) carries no title/artist/artwork, so
  // without this the Liked view falls back to `Liked song / Unknown artist`.
  if (value === 'up') {
    const liveSong =
      window.latestNowPlayingData?.now_playing?.song ||
      window.currentNowPlayingSong || null;
    const onDemandSong = (typeof window.getCurrentOnDemandSong === 'function'
      ? window.getCurrentOnDemandSong()
      : null) || null;
    // On-demand now-playing uses {title,artist,art,id}; live radio uses the
    // same shape, while catalog songs use {trackName,artistName,artworkUrl100}.
    const source = (song?.title && song?.artist)
      ? song
      : (liveSong?.title && liveSong?.artist ? liveSong : null)
        || (onDemandSong?.trackName ? {
          title: onDemandSong.trackName,
          artist: onDemandSong.artistName,
          album: onDemandSong.collectionName,
          art: onDemandSong.artworkUrl100,
          youtubeVideoId: onDemandSong.youtubeVideoId
        } : null);
    const rawTitle = String(source?.title || song?.trackName || '').trim();
    const cleanArtist = String(source?.artist || song?.artistName || '')
      .replace(/\s-\sTopic$/i, '')
      .trim();
    if (rawTitle && cleanArtist && cleanArtist.toLowerCase() !== 'unknown artist') {
      let videoId = source?.youtubeVideoId || '';
      if (!videoId && typeof source?.id === 'string' && /^[\w-]{11}$/.test(source.id)) videoId = source.id;
      if (!videoId && typeof currentRatingTrackKey === 'string' && currentRatingTrackKey.startsWith('youtube:')) {
        const candidate = currentRatingTrackKey.slice('youtube:'.length);
        if (/^[\w-]{11}$/.test(candidate)) videoId = candidate;
      }
      const fallbackArt = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
      const artworkUrl100 = source?.art || source?.artworkUrl100 || song?.art || song?.artworkUrl100 || fallbackArt;
      saveStoredSongInfo(currentRatingTrackKey, {
        track: rawTitle,
        artist: cleanArtist,
        ...(artworkUrl100 ? { artworkUrl100 } : {}),
        details: `Album: ${source?.album || 'N/A'}\nRelease date: N/A\nGenre: N/A\nDuration: N/A`
      });
    }
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
}

async function prefetchSongInfo(song) {
  if (!song?.title || !song?.artist) return;

  const cacheKey = getTrackRatingKey(song);
  if (!cacheKey) return;

  const cached = getStoredSongInfo(cacheKey);
  if (cached?.track && cached?.artist && cached?.details && cached?.artworkUrl100) return;
  if (prefetchingSongInfo.has(cacheKey)) return;

  prefetchingSongInfo.add(cacheKey);
  const fallbackDetails = [
    `Album: ${song.album || 'N/A'}`,
    'Release date: N/A',
    'Genre: N/A',
    'Duration: N/A'
  ].join('\n');

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
      artworkUrl100: song.art || '',
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
        artworkUrl100: match.artworkUrl100
          ?.replace(/^http:/, 'https:')
          .replace(/\d+x\d+bb\./, '600x600bb.') || song.art || '',
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
      artworkUrl100: song.art || '',
      details: fallbackDetails
    });
  }

  prefetchingSongInfo.delete(cacheKey);

  // Details just resolved - grey back in (or out) without a track change.
  // Same single button drives both desktop + the mobile now-playing view.
  try {
    const liveSong = window.latestNowPlayingData?.now_playing?.song || window.currentNowPlayingSong;
    if (liveSong && getTrackRatingKey(liveSong) === cacheKey) {
      refreshSongInfoAvailability(liveSong);
    } else if (getTrackRatingKey(song) === cacheKey) {
      refreshSongInfoAvailability(song);
    }
  } catch {
    // Availability is best-effort; dialog still guards on click.
  }

  const currentSongKey = getTrackRatingKey(window.currentNowPlayingSong);
  if (songInfoDialog?.open && currentSongKey === cacheKey) {
    updateSongInfo();
  }
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

window.lookupAlbumArtwork = async function (title, artist) {
  const cleanArtist = String(artist || '').replace(/\s-\sTopic$/i, '').trim();
  if (!title || !cleanArtist) return '';

  try {
    const response = await searchItunes(`${cleanArtist} ${title}`);
    const normalize = (value) => String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const requestedTitle = normalize(title);
    const requestedArtist = normalize(cleanArtist.split(',')[0]);
    const ranked = (response.results || []).map((track) => {
      const candidateTitle = normalize(track.trackName);
      const candidateArtist = normalize(track.artistName);
      const titleMatches = candidateTitle === requestedTitle ||
        candidateTitle.includes(requestedTitle) || requestedTitle.includes(candidateTitle);
      const artistMatches = candidateArtist.includes(requestedArtist) ||
        requestedArtist.includes(candidateArtist);
      return { track, score: (titleMatches ? 4 : 0) + (artistMatches ? 2 : 0) };
    }).filter((candidate) => candidate.score >= 4)
      .sort((first, second) => second.score - first.score);

    return ranked[0]?.track?.artworkUrl100
      ?.replace(/^http:/, 'https:')
      .replace(/\d+x\d+bb\./, '600x600bb.') || '';
  } catch {
    return '';
  }
};

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

    if (
      window.onDemandPlaybackActive &&
      window.onDemandPlaying
    ) {
      window.toggleOnDemandPlayback?.(false);
    } else {
      controlsRadio.pause();
    }

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
    const onDemandActive =
      Boolean(window.onDemandPlaybackActive) ||
      Boolean(document.body?.classList?.contains('on-demand-active'));
    const onDemandSong = (typeof window.getCurrentOnDemandSong === 'function'
      ? window.getCurrentOnDemandSong()
      : null) || null;
    const liveSong =
      window.latestNowPlayingData
        ?.now_playing?.song ||
      window.currentNowPlayingSong;
    // On-demand and live publish different song shapes; check the active one.
    const activeSong = onDemandActive && onDemandSong?.trackName
      ? {
        title: onDemandSong.trackName,
        artist: onDemandSong.artistName,
        album: onDemandSong.collectionName,
        art: onDemandSong.artworkUrl100,
        youtubeVideoId: onDemandSong.youtubeVideoId
      }
      : liveSong;
    if (
      songInfoButton.disabled ||
      !hasUsableSongDetails(activeSong)
    ) {
      return;
    }

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
      if (
        thumbsUpButton.disabled ||
        !hasUsableLiveArtist(
          window.latestNowPlayingData
            ?.now_playing?.song ||
            window.currentNowPlayingSong
        )
      ) {
        return;
      }

      if (!currentRatingTrackKey) {
        refreshCurrentRating();
      }

      const triggered =
        selectRating(
          thumbsUpButton,
          'up'
        );
      const savedRating = getStoredRatings()[currentRatingTrackKey] || null;
      void persistRatingToCloud(currentRatingTrackKey, savedRating);

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

if (onDemandLikeButton) {
  onDemandLikeButton.addEventListener('click', () => {
    if (!currentRatingTrackKey) refreshCurrentRating();
    selectRating(onDemandLikeButton, 'up');
    const savedRating = getStoredRatings()[currentRatingTrackKey] || null;
    void persistRatingToCloud(currentRatingTrackKey, savedRating);
  });
}

if (thumbsDownButton) {
  thumbsDownButton.setAttribute(
    'aria-pressed',
    'false'
  );

  thumbsDownButton.addEventListener(
    'click',
    () => {
      if (
        thumbsDownButton.disabled ||
        !hasUsableLiveArtist(
          window.latestNowPlayingData
            ?.now_playing?.song ||
            window.currentNowPlayingSong
        )
      ) {
        return;
      }

      if (!currentRatingTrackKey) {
        refreshCurrentRating();
      }

      const triggered =
        selectRating(
          thumbsDownButton,
          'down'
        );
      const savedRating = getStoredRatings()[currentRatingTrackKey] || null;
      void persistRatingToCloud(currentRatingTrackKey, savedRating);

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
