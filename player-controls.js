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
let currentRatingTrackKey = '';
let feedbackTimeout = 0;
let songInfoMetadataRequestId = 0;

let likeFeedbackShown = false;
let dislikeFeedbackShown = false;

const prefetchingSongInfo =
  new Set();
const queuedCatalogSongInfo =
  new Set();
const catalogSongInfoQueue = [];
let catalogSongInfoQueueActive = 0;
let catalogSongInfoQueueScheduled = false;

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
    if (dialog === songInfoDialog || dialog === sleepTimerDialog) {
      dialog.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 110,
          easing: 'cubic-bezier(0, 0, 0.2, 1)'
        }
      );
    }
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

  songInfoDetails.replaceChildren();
  String(details || '').split('\n').forEach((line, index) => {
    if (index) songInfoDetails.appendChild(document.createElement('br'));
    const copyrightPrefix = 'Asset: © ';
    if (line.startsWith(copyrightPrefix)) {
      songInfoDetails.append('Asset: ');
      const copyrightSymbol = document.createElement('small');
      copyrightSymbol.className = 'song-info-copyright-symbol';
      copyrightSymbol.textContent = '©';
      songInfoDetails.append(copyrightSymbol, ` ${line.slice(copyrightPrefix.length)}`);
    } else {
      songInfoDetails.append(document.createTextNode(line));
    }
  });

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

function saveStoredSongInfo(key, entry, { refreshSavedAt = false } = {}) {
  if (!key || !entry) return;

  try {
    const cache = JSON.parse(
      localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}'
    );
    const now = Date.now();
    cache[key] = {
      ...cache[key],
      ...entry,
      savedAt: refreshSavedAt || !cache[key]?.savedAt ? now : cache[key].savedAt,
      cacheUpdatedAt: now
    };

    const oldestKeys = Object.keys(cache)
      .sort((first, second) =>
        (cache[first]?.cacheUpdatedAt || cache[first]?.savedAt || 0) -
        (cache[second]?.cacheUpdatedAt || cache[second]?.savedAt || 0)
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

function notifyRatingChanged(trackKey, rating) {
  const details = getRatingTrackDetails(trackKey);
  let info = {};
  try {
    info = JSON.parse(localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}')?.[trackKey] || {};
  } catch { /* The rating change still updates the current tab. */ }
  window.dispatchEvent(new CustomEvent('thaalam:rating-changed', {
    detail: {
      trackKey,
      rating,
      song: {
        trackKey,
        trackName: info.track || details.title || 'Liked song',
        artistName: info.artist || details.artist || 'Unknown artist',
        artworkUrl100: info.artworkUrl100 || info.artwork || details.artwork || '',
        collectionName: info.album || details.album || '',
        providerTrackId: info.providerTrackId || details.providerTrackId || '',
        durationSeconds: Number(info.durationSeconds) || details.durationSeconds || 0,
        ...(details.videoId ? { youtubeVideoId: details.videoId } : {})
      }
    }
  }));
}

function removeFavoriteRating(trackKey) {
  if (!trackKey) return false;
  const ratings = getStoredRatings();
  delete ratings[trackKey];
  if (!saveStoredRatings(ratings)) return false;
  if (currentRatingTrackKey === trackKey) applyStoredRating(null);
  notifyRatingChanged(trackKey, null);
  void persistRatingToCloud(trackKey, null);
  return true;
}

window.removeFavoriteRating = removeFavoriteRating;

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
      releaseDate: onDemandSong.releaseDate,
      primaryGenreName: onDemandSong.primaryGenreName,
      art: onDemandSong.artworkUrl100,
      providerTrackId: onDemandSong.providerTrackId,
      youtubeVideoId: onDemandSong.youtubeVideoId,
      trackTimeMillis: onDemandSong.trackTimeMillis,
      durationSeconds: onDemandSong.durationSeconds
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
  const cachedDuration = Number(getStoredSongInfo(trackKey)?.durationSeconds) || 0;
  const durationSeconds = Math.max(0, Math.floor(
    Number(song.durationSeconds) || Number(song.trackTimeMillis) / 1000 || cachedDuration ||
    (onDemandActive ? 0 : Number(window.latestNowPlayingData?.now_playing?.duration)) || 0
  ));
  return {
    title: String(rawTitle || '').trim(),
    artist: rawArtist,
    album: String(song.album || song.collectionName || '').trim(),
    providerTrackId: String(song.providerTrackId || '').trim(),
    videoId,
    artwork: String(artwork || '').trim(),
    durationSeconds
  };
}

function getPendingRatingDeletes(ownerOverride = '') {
  const userId = ownerOverride || window.getThaalamGoogleUserId?.() ||
    localStorage.getItem(`${RATING_STORAGE_KEY}-owner`) || 'anonymous';
  const key = `${RATING_DELETE_STORAGE_PREFIX}${userId}`;
  try {
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePendingRatingDeletes(deletions, ownerOverride = '') {
  const userId = ownerOverride || window.getThaalamGoogleUserId?.() ||
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
  const userId = window.getThaalamGoogleUserId?.();
  if (!token && !userId) return null;
  const response = await fetch('/api/ratings', {
    method,
    credentials: 'same-origin',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (response.status === 401) {
    sessionStorage.removeItem('thaalam.googleAccessToken');
    localStorage.removeItem('thaalam.googleAccessToken');
    localStorage.removeItem('thaalam.googleAccessTokenExpiresAt');
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
  if (!window.getThaalamGoogleAccessToken?.() && !window.getThaalamGoogleUserId?.()) return;
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
  if (!userId) return;
  try {
    const ratingsOwnerKey = `${RATING_STORAGE_KEY}-owner`;
    const owner = localStorage.getItem(ratingsOwnerKey) || 'anonymous';
    const response = await requestCloudRatings('GET');
    const remoteRatings = {};
    for (const entry of response.ratings || []) {
      if (entry.track_key && (entry.rating === 'up' || entry.rating === 'down')) {
        remoteRatings[entry.track_key] = entry.rating;
      }
    }

    const pendingDeletes = getPendingRatingDeletes(userId);
    if (owner === 'anonymous') {
      getPendingRatingDeletes('anonymous').forEach((trackKey) => pendingDeletes.add(trackKey));
    }
    if (pendingDeletes.size) {
      await requestCloudRatings('DELETE', { trackKeys: [...pendingDeletes] });
      for (const trackKey of pendingDeletes) {
        delete remoteRatings[trackKey];
        pendingDeletes.delete(trackKey);
      }
    }
    savePendingRatingDeletes(pendingDeletes, userId);
    if (owner === 'anonymous') savePendingRatingDeletes(new Set(), 'anonymous');

    const importingLocalRatings = owner !== userId;
    // Guest likes stay in the active device list and merge into the account.
    // Switching directly between Google accounts still restores that account's
    // own device cache instead of copying another account's likes across.
    let localRatings = getStoredRatings();
    if (owner && owner !== userId) {
      localStorage.setItem(`${RATING_STORAGE_KEY}:${owner}`, JSON.stringify(localRatings));
      let accountRatings = {};
      try {
        accountRatings = JSON.parse(localStorage.getItem(`${RATING_STORAGE_KEY}:${userId}`) || '{}');
      } catch { accountRatings = {}; }
      if (owner === 'anonymous') {
        localRatings = { ...accountRatings, ...localRatings };
      } else {
        localRatings = accountRatings;
      }
      saveStoredRatings(localRatings);
    }
    if (!importingLocalRatings) {
      // Once this device belongs to the signed-in account, the server is the
      // source of truth. Never re-upload stale browser likes over cloud unlikes.
      localRatings = { ...remoteRatings };
      saveStoredRatings(localRatings);
    }
    const localEntries = (importingLocalRatings ? Object.entries(localRatings) : [])
      .filter(([, rating]) => rating === 'up' || rating === 'down')
      .slice(0, 500);
    let songInfoCache = {};
    try { songInfoCache = JSON.parse(localStorage.getItem(SONG_INFO_STORAGE_KEY) || '{}'); } catch { songInfoCache = {}; }
    const uploads = [];
    for (const [trackKey, rating] of localEntries) {
      if (remoteRatings[trackKey] === rating) continue;
      // Prefer the snapshot taken at like-time (has real title/artist/artwork).
      // The raw key alone is lossy: `youtube:ID` carries no names at all.
      const cached = songInfoCache?.[trackKey] || {};
      let [title = '', artist = ''] = trackKey.startsWith('youtube:')
        ? ['', '']
        : trackKey.split('|');
      title = cached.track || title;
      artist = cached.artist || artist;
      const album = cached.album || '';
      const providerTrackId = cached.providerTrackId || '';
      let videoId = trackKey.startsWith('youtube:') ? trackKey.slice('youtube:'.length) : '';
      if (!/^[\w-]{11}$/.test(videoId)) videoId = '';
      const artwork = cached.artworkUrl100 || cached.artwork || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
      const durationSeconds = Math.max(0, Math.floor(Number(cached.durationSeconds) || 0));
      uploads.push({ trackKey, rating, title, artist, album, providerTrackId, videoId, artwork, durationSeconds });
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
if (window.getThaalamGoogleUserId?.()) {
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

    notifyRatingChanged(currentRatingTrackKey, null);

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
    const source = (window.onDemandPlaybackActive && onDemandSong?.trackName)
      ? {
          title: onDemandSong.trackName,
          artist: onDemandSong.artistName,
          album: onDemandSong.collectionName,
          releaseDate: onDemandSong.releaseDate,
          primaryGenreName: onDemandSong.primaryGenreName,
          art: onDemandSong.artworkUrl100,
          providerTrackId: onDemandSong.providerTrackId,
          youtubeVideoId: onDemandSong.youtubeVideoId
        }
      : (song?.title && song?.artist ? song : null)
        || (liveSong?.title && liveSong?.artist ? liveSong : null)
        || (onDemandSong?.trackName ? {
          title: onDemandSong.trackName,
          artist: onDemandSong.artistName,
          album: onDemandSong.collectionName,
          releaseDate: onDemandSong.releaseDate,
          primaryGenreName: onDemandSong.primaryGenreName,
          art: onDemandSong.artworkUrl100,
          providerTrackId: onDemandSong.providerTrackId,
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
      // Preserve resolved album metadata while normalizing the details shown
      // in the Now Playing dialog.
      const existingInfo = getStoredSongInfo(currentRatingTrackKey) || {};
      const artworkUrl100 = source?.art || source?.artworkUrl100 || song?.art || song?.artworkUrl100 ||
        existingInfo.artworkUrl100 || existingInfo.artwork || fallbackArt;
      const existingDetails = existingInfo.details;
      const cachedLines = Object.fromEntries(
        String(existingDetails || '').split('\n').map((line) => {
          const separator = line.indexOf(':');
          return separator < 0
            ? ['', '']
            : [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
        })
      );
      const details = formatSongInfoDetails(
        source?.album || existingInfo.album || cachedLines.album,
        cachedLines['release date'],
        cachedLines.genre
      );
      saveStoredSongInfo(currentRatingTrackKey, {
        track: rawTitle,
        artist: cleanArtist,
        album: source?.album || existingInfo.album || '',
        providerTrackId: source?.providerTrackId || existingInfo.providerTrackId || '',
        durationSeconds: Math.max(0, Math.floor(
          Number(source?.durationSeconds) || Number(source?.trackTimeMillis) / 1000 ||
          Number(window.latestNowPlayingData?.now_playing?.duration) || 0
        )),
        ...(artworkUrl100 ? { artworkUrl100 } : {}),
        details
      }, { refreshSavedAt: true });
      if (!source?.providerTrackId && typeof window.resolveLikedSongIdentity === 'function') {
        const trackKey = currentRatingTrackKey;
        void window.resolveLikedSongIdentity({
          trackName: rawTitle,
          artistName: cleanArtist,
          collectionName: source?.album || ''
        }).then((identity) => {
          if (!identity?.providerTrackId || getStoredRatings()[trackKey] !== 'up') return;
          const latestInfo = getStoredSongInfo(trackKey) || {};
          saveStoredSongInfo(trackKey, {
            providerTrackId: identity.providerTrackId,
            album: identity.collectionName || latestInfo.album || '',
            ...(identity.artworkUrl100 ? { artworkUrl100: latestInfo.artworkUrl100 || identity.artworkUrl100 } : {})
          });
          void persistRatingToCloud(trackKey, 'up');
          notifyRatingChanged(trackKey, 'up');
        }).catch((error) => {
          console.warn('Could not resolve the liked song recording.', error);
        });
      }
    }
  }

  applyStoredRating(
    value
  );

  notifyRatingChanged(currentRatingTrackKey, value);

  return true;
}

window.saveLikedSongPlaybackIdentity = (song) => {
  const trackKey = song?.trackKey;
  if (!trackKey || !song?.providerTrackId) return;
  let isLiked = getStoredRatings()[trackKey] === 'up';
  if (!isLiked) {
    const userId = window.getThaalamGoogleUserId?.();
    try {
      const cached = JSON.parse(localStorage.getItem(`thaalam.favourites:${userId}`) || 'null');
      isLiked = Array.isArray(cached?.ratings) && cached.ratings.some((entry) =>
        entry.track_key === trackKey && entry.rating === 'up');
    } catch { /* The local rating check above remains authoritative. */ }
  }
  if (!isLiked) return;
  const existingInfo = getStoredSongInfo(trackKey) || {};
  saveStoredSongInfo(trackKey, {
    track: song.trackName || existingInfo.track || '',
    artist: song.artistName || existingInfo.artist || '',
    album: song.collectionName || existingInfo.album || '',
    providerTrackId: song.providerTrackId,
    ...(song.artworkUrl100 ? { artworkUrl100: song.artworkUrl100 } : {})
  });
  void persistRatingToCloud(trackKey, 'up');
  notifyRatingChanged(trackKey, 'up');
};

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
    'album-placeholder.svg?v=3';

  showSongInfo(
    '',
    '',
    ''
  );

  const onDemandActive = Boolean(window.onDemandPlaybackActive) ||
    Boolean(document.body?.classList?.contains('on-demand-active'));
  const onDemandSong = onDemandActive
    ? window.getCurrentOnDemandSong?.()
    : null;
  const song = onDemandSong?.trackName
    ? {
      title: onDemandSong.trackName,
      artist: onDemandSong.artistName,
      album: onDemandSong.collectionName,
      releaseDate: onDemandSong.releaseDate,
      primaryGenreName: onDemandSong.primaryGenreName,
      art: onDemandSong.artworkUrl100,
      youtubeVideoId: onDemandSong.youtubeVideoId
    }
    : window.currentNowPlayingSong;
  if (!song?.title || !song?.artist) {
    showSongInfo('', '', 'Track details are unavailable.');
    return;
  }

  updateStoredRatingForCurrentSong(song);
  const cached = getStoredSongInfo(getTrackRatingKey(song));
  const cachedDetails = Object.fromEntries(
    String(cached?.details || '').split('\n').map((line) => {
      const separator = line.indexOf(':');
      return separator < 0
        ? ['', '']
        : [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    })
  );
  const album = song.album || cached?.album || cachedDetails.album || '';
  const cachedReleaseDate = formatReleaseDate(cachedDetails['release date']);
  const releaseDate = cachedReleaseDate !== 'N/A'
    ? cachedDetails['release date']
    : song.releaseDate;
  const cachedGenre = getUsableSongGenre(cachedDetails.genre, song.artist);

  showSongInfo(
    cached?.track || song.title,
    cached?.artist || song.artist,
    formatSongInfoDetails(
      album,
      formatReleaseDate(releaseDate),
      cachedGenre !== 'N/A'
        ? cachedGenre
        : getUsableSongGenre(song.primaryGenreName, song.artist)
    )
  );

  const cacheKey = getTrackRatingKey(song);
  const requestId = ++songInfoMetadataRequestId;
  if (cacheKey && typeof window.lookupCatalogSongMetadata === 'function') {
    void window.lookupCatalogSongMetadata(song.title, song.artist)
      .then((metadata) => {
        const activeOnDemand = Boolean(window.onDemandPlaybackActive) ||
          Boolean(document.body?.classList?.contains('on-demand-active'));
        const activeOnDemandSong = activeOnDemand
          ? window.getCurrentOnDemandSong?.()
          : null;
        const activeSong = activeOnDemand && activeOnDemandSong?.trackName
          ? {
            title: activeOnDemandSong.trackName,
            artist: activeOnDemandSong.artistName,
            youtubeVideoId: activeOnDemandSong.youtubeVideoId
          }
          : window.currentNowPlayingSong;
        if (requestId !== songInfoMetadataRequestId || !songInfoDialog?.open ||
            getTrackRatingKey(activeSong) !== cacheKey) return;

        const currentInfo = getStoredSongInfo(cacheKey) || cached || {};
        const currentDetails = Object.fromEntries(
          String(currentInfo.details || '').split('\n').map((line) => {
            const separator = line.indexOf(':');
            return separator < 0
              ? ['', '']
              : [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
          })
        );
        const releaseDateFromLookup = formatReleaseDate(metadata.releaseDate);
        const savedReleaseDate = formatReleaseDate(currentDetails['release date']);
        const details = formatSongInfoDetails(
          metadata.album || song.album || currentInfo.album || currentDetails.album,
          releaseDateFromLookup !== 'N/A'
            ? releaseDateFromLookup
            : savedReleaseDate !== 'N/A'
              ? currentDetails['release date']
              : song.releaseDate,
          getUsableSongGenre(
            metadata.genre || currentDetails.genre || song.primaryGenreName,
            song.artist
          )
        );
        saveStoredSongInfo(cacheKey, {
          track: song.title,
          artist: song.artist,
          album: metadata.album || song.album || currentInfo.album || '',
          artworkUrl100: song.art || currentInfo.artworkUrl100 || '',
          details
        });
        showSongInfo(song.title, song.artist, details);
      })
      .catch((error) => {
        console.warn('Could not refresh now-playing song metadata.', error);
      });
  }
}

function formatReleaseDate(value) {
  const releaseDate = String(value || '').trim();
  if (!releaseDate || /^\d{4}$/.test(releaseDate)) return 'N/A';
  const isoDate = releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  const date = isoDate
    ? new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])))
    : new Date(releaseDate);
  return Number.isNaN(date.getTime())
    ? 'N/A'
    : new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      }).format(date);
}

function formatSongInfoDetails(album, releaseDate = 'N/A', genre = 'N/A') {
  return [
    `Album: ${album || 'N/A'}`,
    `Release date: ${releaseDate || 'N/A'}`,
    `Genre: ${genre || 'N/A'}`,
    'Asset: © Saavn Media Limited'
  ].join('\n');
}

function getUsableSongGenre(value, artist = '') {
  const genre = String(value || '').trim();
  if (!genre || genre.length > 48 ||
      /^(?:new releases|international|hindi|malayalam|tamil)(?:$|[\s:/-])/i.test(genre)) return 'N/A';

  const normalize = (text) => text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const genreParts = genre.split(/[,;|/]/).map(normalize).filter(Boolean);
  const artistParts = String(artist)
    .split(/,|&|\bfeat(?:uring)?\b|\bwith\b|\bx\b|\u00d7|[/;]/i)
    .map(normalize)
    .filter(Boolean);

  if (genreParts.length > 2 || genreParts.some((part) => artistParts.includes(part))) {
    return 'N/A';
  }
  return genre;
}

window.openCurrentSongInfo = () => {
  updateSongInfo();
  openDialog(songInfoDialog);
};

async function prefetchSongInfo(song) {
  if (!song?.title || !song?.artist) return;

  const cacheKey = getTrackRatingKey(song);
  if (!cacheKey) return;

  const cached = getStoredSongInfo(cacheKey);
  const cachedReleaseDate = cached?.details?.match(/^Release date:\s*(.*)$/mi)?.[1]?.trim();
  const cachedHasReleaseDate = Boolean(
    cachedReleaseDate && cachedReleaseDate !== 'N/A' && formatReleaseDate(cachedReleaseDate) !== 'N/A'
  );
  const cachedGenre = cached?.details?.match(/^Genre:\s*(.*)$/mi)?.[1]?.trim();
  const cachedHasGenre = getUsableSongGenre(cachedGenre, song.artist) !== 'N/A';
  const cacheFresh = cached?.metadataCheckedAt &&
    Date.now() - cached.metadataCheckedAt < 7 * 24 * 60 * 60 * 1000;
  if (cached?.track && cached?.artist && cached?.artworkUrl100 &&
      (cacheFresh || (cachedHasReleaseDate && cachedHasGenre))) return;
  if (prefetchingSongInfo.has(cacheKey)) return;

  prefetchingSongInfo.add(cacheKey);
  const fallbackDetails = formatSongInfoDetails(
    song.album,
    formatReleaseDate(song.releaseDate),
    getUsableSongGenre(song.primaryGenreName, song.artist)
  );

  try {
    const musicData = await searchAppleMusicMetadata(song.artist, song.title);
    const normalize = (value) => value
      ?.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || '';

    const requestedTitle = normalize(song.title);
    const requestedArtist = normalize((() => {
      const sections = (song.artist || '').split(/,|&|\bfeat(?:uring)?\b|\bwith\b/i).map((part) => part.trim()).filter(Boolean);
      let primary = sections[0] || '';
      if (primary === 'Background Vocalist' && sections.length > 1) primary = sections[1];
      return primary;
    })());
    const exactTitleMatches = musicData.results?.filter((track) =>
      normalize(track.trackName) === requestedTitle
    ) || [];
    const match = exactTitleMatches.find((recording) =>
      normalize(recording.artistName).includes(requestedArtist)
    );

    let entry = {
      track: song.title,
      artist: song.artist,
      artworkUrl100: song.art || '',
      details: fallbackDetails
    };

    if (match) {
      entry = {
        track: match.trackName || song.title,
        artist: match.artistName || song.artist,
        album: match.collectionName || song.album || '',
        releaseDate: match.releaseDate || song.releaseDate || '',
        primaryGenreName: getUsableSongGenre(match.primaryGenreName, song.artist),
        artworkUrl100: match.artworkUrl100
          ?.replace(/^http:/, 'https:')
          .replace(/\d+x\d+bb\./, '600x600bb.') || song.art || '',
        details: formatSongInfoDetails(
          match.collectionName || song.album,
          formatReleaseDate(match.releaseDate || song.releaseDate),
          getUsableSongGenre(match.primaryGenreName, song.artist)
        )
      };
    } else {
      entry.releaseDate = song.releaseDate || '';
      entry.primaryGenreName = getUsableSongGenre(song.primaryGenreName, song.artist);
    }

    saveStoredSongInfo(cacheKey, {
      ...entry,
      metadataCheckedAt: Date.now()
    });
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

function scheduleCatalogSongInfoQueue() {
  if (catalogSongInfoQueueScheduled || !catalogSongInfoQueue.length) return;
  catalogSongInfoQueueScheduled = true;
  const start = () => {
    catalogSongInfoQueueScheduled = false;
    while (catalogSongInfoQueueActive < 2 && catalogSongInfoQueue.length) {
      const { key, song } = catalogSongInfoQueue.shift();
      catalogSongInfoQueueActive += 1;
      void prefetchSongInfo(song)
        .catch((error) => console.warn('Could not prefetch catalog song metadata.', error))
        .finally(() => {
          catalogSongInfoQueueActive -= 1;
          queuedCatalogSongInfo.delete(key);
          scheduleCatalogSongInfoQueue();
        });
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 1500 });
  } else {
    window.setTimeout(start, 0);
  }
}

window.prefetchCatalogSongInfo = (songs) => {
  const songList = Array.isArray(songs) ? songs : [songs];
  songList.forEach((item) => {
    if (!item?.trackName || !item?.artistName) return;
    const song = {
      title: item.trackName,
      artist: item.artistName,
      album: item.collectionName || '',
      releaseDate: item.releaseDate || '',
      primaryGenreName: item.primaryGenreName || '',
      art: item.artworkUrl100 || '',
      youtubeVideoId: item.youtubeVideoId || ''
    };
    const key = getTrackRatingKey(song);
    if (!key || queuedCatalogSongInfo.has(key)) return;
    queuedCatalogSongInfo.add(key);
    catalogSongInfoQueue.push({ key, song });
  });
  scheduleCatalogSongInfoQueue();
};

window.getCachedCatalogSongInfo = (title, artist) => {
  const cached = getStoredSongInfo(getTrackRatingKey({ title, artist }));
  if (!cached) return null;
  const cachedDetails = Object.fromEntries(
    String(cached.details || '').split('\n').map((line) => {
      const separator = line.indexOf(':');
      return separator < 0
        ? ['', '']
        : [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    })
  );
  const releaseDate = cached.releaseDate || cachedDetails['release date'] || '';
  const genre = cached.primaryGenreName || cachedDetails.genre || '';
  return {
    album: cached.album || cachedDetails.album || '',
    releaseDate: formatReleaseDate(releaseDate) === 'N/A' ? '' : releaseDate,
    genre: getUsableSongGenre(genre, artist) === 'N/A' ? '' : genre
  };
};

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

async function searchItunes(term, limit = 15) {
  const url = new URL('/api/music-search', window.location.origin);
  url.searchParams.set('q', term);
  url.searchParams.set('limit', String(Math.min(25, limit)));
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The song search failed (${response.status}).`);
  const data = await response.json();
  return {
    results: (data?.results || []).map((song) => {
      const sections = (song.artist || '').split(/,|&|\bfeat(?:uring)?\b|\bwith\b/i).map((part) => part.trim()).filter(Boolean);
      let primaryArtist = sections[0] || '';
      if (primaryArtist === 'Background Vocalist' && sections.length > 1) {
        primaryArtist = sections[1];
      }
      return {
        trackName: song.title,
        artistName: primaryArtist,
        collectionName: song.album,
        releaseDate: song.year || '',
        artworkUrl100: song.thumbnail,
        trackTimeMillis: song.durationSeconds ? Math.round(song.durationSeconds * 1000) : 0,
        providerTrackId: song.id
      };
    })
  };
}

async function searchAppleMusicMetadata(artist, title) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', `${artist} ${title}`);
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '25');
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Apple song metadata lookup failed (${response.status}).`);
  }
  const data = await response.json();
  return {
    results: (data?.results || []).map((song) => ({
      trackName: song.trackName,
      artistName: song.artistName,
      collectionName: song.collectionName,
      releaseDate: song.releaseDate,
      primaryGenreName: song.primaryGenreName,
      artworkUrl100: song.artworkUrl100
    }))
  };
}

window.lookupCatalogSongMetadata = async (title, artist) => {
  if (!title || !artist) return { album: '', genre: '', releaseDate: '' };

  const musicData = await searchAppleMusicMetadata(artist, title);
  const normalize = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const requestedTitle = normalize(title);
  const primaryArtist = String(artist)
    .split(/,|&|\bfeat(?:uring)?\b|\bwith\b|\bx\b|\u00d7/i)[0]
    .trim();
  const requestedArtist = normalize(primaryArtist);
  const match = musicData.results?.find((track) =>
    normalize(track.trackName) === requestedTitle &&
    normalize(track.artistName).includes(requestedArtist)
  );
  const genre = match?.primaryGenreName || '';
  const metadata = {
    album: match?.collectionName || '',
    genre: getUsableSongGenre(genre, artist) === 'N/A' ? '' : genre,
    releaseDate: match?.releaseDate || ''
  };
  if (match) {
    const cacheKey = getTrackRatingKey({ title, artist });
    saveStoredSongInfo(cacheKey, {
      track: match.trackName || title,
      artist: match.artistName || artist,
      album: metadata.album,
      releaseDate: metadata.releaseDate,
      primaryGenreName: metadata.genre,
      metadataCheckedAt: Date.now(),
      details: formatSongInfoDetails(
        metadata.album,
        formatReleaseDate(metadata.releaseDate),
        metadata.genre || 'N/A'
      )
    });
  }
  return metadata;
};

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
    `Playback will pause in ${formatted}`;

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
    if ((!onDemandActive && songInfoButton.disabled) || !hasUsableSongDetails(activeSong)) {
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
