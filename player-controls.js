const controlsRadio = document.getElementById('radio');
const songInfoButton = document.getElementById('songInfoButton');
const songInfoDialog = document.getElementById('songInfoDialog');
const songInfoArt = document.getElementById('songInfoArt');
const songInfoTrack = document.getElementById('songInfoTrack');
const songInfoArtist = document.getElementById('songInfoArtist');
const songInfoDetails = document.getElementById('songInfoDetails');
const songInfoBackground = document.getElementById('songInfoBackground');
const songInfoWikiLink = document.getElementById('songInfoWikiLink');
const sleepTimerButton = document.getElementById('sleepTimerButton');
const sleepTimerDialog = document.getElementById('sleepTimerDialog');
const sleepTimerStatus = document.getElementById('sleepTimerStatus');
const cancelSleepTimerButton = document.getElementById('cancelSleepTimer');
let sleepTimerDeadline = 0;
let sleepTimerInterval = 0;
let songInfoRequestId = 0;
let itunesRequestId = 0;
const itunesTrackCache = new Map();

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function showSongInfo(track, artist, details) {
  songInfoTrack.textContent = track || '';
  songInfoArtist.textContent = artist || '';
  songInfoDetails.textContent = details || '';
  songInfoTrack.hidden = !track;
  songInfoArtist.hidden = !artist;
  songInfoDetails.hidden = !details;
}

async function updateSongInfo() {
  const requestId = ++songInfoRequestId;
  const logo = document.getElementById('logoImg');
  songInfoArt.src = logo?.currentSrc || logo?.src || 'logo.png';
  showSongInfo('', '', '');
  songInfoBackground.textContent = '';
  songInfoBackground.hidden = true;
  songInfoWikiLink.hidden = true;
  let fallbackSongInfo = null;

  try {
    const nowPlayingResponse = await fetch('https://radio.thaalam24x7.in/api/nowplaying/thaalam_24x7', { cache: 'no-store' });
    if (!nowPlayingResponse.ok) throw new Error('Unable to load current track.');
    const nowPlayingData = await nowPlayingResponse.json();
    const song = nowPlayingData?.now_playing?.song;
    if (!song?.title || !song?.artist) throw new Error('Track details are unavailable.');
    const fallbackAlbumDetails = [
      `Album: ${song.album || 'N/A'}`,
      'Release date: N/A',
      'Genre: N/A',
      'Duration: N/A'
    ].join('\n');
    fallbackSongInfo = {
      track: song.title,
      artist: song.artist,
      details: fallbackAlbumDetails || 'Additional track details are unavailable.'
    };

    fetchWikipediaSongBackground(song).then((background) => {
      if (requestId !== songInfoRequestId) return;
      if (background?.url) {
        songInfoBackground.textContent = background.summary;
        songInfoBackground.hidden = false;
        songInfoWikiLink.href = background.url;
        songInfoWikiLink.textContent = `Source: Wikipedia - ${background.title}`;
        songInfoWikiLink.hidden = false;
      }
    }).catch(() => {
      if (requestId === songInfoRequestId) songInfoBackground.hidden = true;
    });

    const musicData = await searchItunes(`${song.artist} ${song.title}`);
    if (requestId !== songInfoRequestId) return;

    const normalize = (value) => value?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') || '';
    const requestedTitle = normalize(song.title);
    const requestedArtist = normalize(song.artist.split(',')[0]);
    const exactTitleMatches = musicData.results?.filter((track) =>
      normalize(track.trackName) === requestedTitle
    ) || [];
    const artistMatch = exactTitleMatches.find((recording) => {
      return normalize(recording.artistName).includes(requestedArtist);
    });
    const match = artistMatch || exactTitleMatches[0];

    if (!match) {
      showSongInfo(fallbackSongInfo.track, fallbackSongInfo.artist, fallbackSongInfo.details);
      return;
    }

    const releaseDate = match.releaseDate ? new Date(match.releaseDate).toLocaleDateString() : '';
    const duration = match.trackTimeMillis
      ? `${Math.floor(match.trackTimeMillis / 60000)}:${String(Math.floor(match.trackTimeMillis / 1000) % 60).padStart(2, '0')}`
      : '';
    const displayTrack = match.trackName;
    const displayArtist = match.artistName || song.artist;
    const albumDetails = [
      `Album: ${match.collectionName || song.album || 'N/A'}`,
      `Release date: ${releaseDate || 'N/A'}`,
      `Genre: ${match.primaryGenreName || 'N/A'}`,
      `Duration: ${duration || 'N/A'}`
    ];
    const displayDetails = albumDetails.length
      ? albumDetails.join('\n')
      : fallbackAlbumDetails;
    showSongInfo(displayTrack, displayArtist, displayDetails);
  } catch (error) {
    if (requestId === songInfoRequestId) {
      if (fallbackSongInfo) {
        showSongInfo(fallbackSongInfo.track, fallbackSongInfo.artist, fallbackSongInfo.details);
      } else {
        showSongInfo('', '', error.message || 'Track details are unavailable.');
      }
    }
  }
}

async function fetchWikipediaSongBackground(song) {
  const artist = song.artist.split(',')[0].trim();
  const search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `"${song.title}" ${artist} song`,
    srlimit: '5',
    format: 'json',
    origin: '*'
  });
  const searchResponse = await fetch(`https://en.wikipedia.org/w/api.php?${search}`);
  if (!searchResponse.ok) throw new Error('Wikipedia search failed.');

  const searchData = await searchResponse.json();
  const normalize = (value) => value?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  const normalizedTitle = normalize(song.title);
  const article = searchData.query?.search?.find((result) =>
    normalize(result.title).startsWith(normalizedTitle)
  );
  if (!article) return null;

  const summaryQuery = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    pageids: String(article.pageid),
    format: 'json',
    origin: '*'
  });
  const summaryResponse = await fetch(`https://en.wikipedia.org/w/api.php?${summaryQuery}`);
  if (!summaryResponse.ok) throw new Error('Wikipedia summary failed.');

  const summaryData = await summaryResponse.json();
  const page = summaryData.query?.pages?.[article.pageid];
  return page?.extract
    ? { title: page.title, summary: page.extract, url: `https://en.wikipedia.org/?curid=${article.pageid}` }
    : null;
}

function searchItunes(term) {
  const cacheKey = term.toLowerCase();
  if (itunesTrackCache.has(cacheKey)) return Promise.resolve(itunesTrackCache.get(cacheKey));

  return new Promise((resolve, reject) => {
    const callbackName = `thaalamItunesCallback${++itunesRequestId}`;
    const query = new URLSearchParams({ term, entity: 'song', limit: '15', callback: callbackName });
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => finish(new Error('iTunes lookup timed out.')), 8000);

    function finish(error, data) {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
      if (error) {
        reject(error);
        return;
      }
      itunesTrackCache.set(cacheKey, data);
      resolve(data);
    }

    window[callbackName] = (data) => finish(null, data);
    script.onerror = () => finish(new Error('iTunes track details are unavailable.'));
    script.src = `https://itunes.apple.com/search?${query}`;
    document.head.appendChild(script);
  });
}

function stopSleepTimer() {
  window.clearInterval(sleepTimerInterval);
  sleepTimerInterval = 0;
  sleepTimerDeadline = 0;
  sleepTimerStatus.textContent = '';
  cancelSleepTimerButton.hidden = true;
  sleepTimerButton.classList.remove('timer-active');
  sleepTimerButton.setAttribute('aria-pressed', 'false');
  sleepTimerButton.title = 'Sleep timer';
}

function refreshSleepTimerStatus() {
  const remaining = Math.max(0, Math.ceil((sleepTimerDeadline - Date.now()) / 1000));
  if (remaining <= 0) {
    stopSleepTimer();
    controlsRadio.pause();
    sleepTimerStatus.textContent = 'Timer complete. Playback paused.';
    openDialog(sleepTimerDialog);
    return;
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  sleepTimerStatus.textContent = `Playback will pause in ${minutes}:${String(seconds).padStart(2, '0')}.`;
  sleepTimerButton.title = `Sleep timer: ${minutes}:${String(seconds).padStart(2, '0')} remaining`;
}

function startSleepTimer(minutes) {
  stopSleepTimer();
  sleepTimerDeadline = Date.now() + minutes * 60 * 1000;
  sleepTimerButton.classList.add('timer-active');
  sleepTimerButton.setAttribute('aria-pressed', 'true');
  cancelSleepTimerButton.hidden = false;
  refreshSleepTimerStatus();
  sleepTimerInterval = window.setInterval(refreshSleepTimerStatus, 1000);
  sleepTimerDialog.close();
}

songInfoButton.addEventListener('click', () => {
  updateSongInfo();
  openDialog(songInfoDialog);
});

sleepTimerButton.addEventListener('click', () => openDialog(sleepTimerDialog));

sleepTimerDialog.querySelectorAll('[data-minutes]').forEach((button) => {
  button.addEventListener('click', () => startSleepTimer(Number(button.dataset.minutes)));
});

cancelSleepTimerButton.addEventListener('click', () => {
  stopSleepTimer();
  sleepTimerDialog.close();
});

controlsRadio.addEventListener('ended', stopSleepTimer);
