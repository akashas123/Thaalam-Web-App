import { handleJioSaavnAlbum, handleJioSaavnSearch } from './jiosaavn-search.mjs';

// Probe A: does search now include albums?
const res = await handleJioSaavnSearch(
  new Request('http://localhost/api/jiosaavn-search?q=' + encodeURIComponent('rockstar') + '&limit=3')
);
const data = await res.json();
console.log('SEARCH STATUS', res.status);
console.log('SONGS', (data.results || []).length, 'ALBUMS', (data.albums || []).length);
for (const a of (data.albums || []).slice(0, 5)) {
  console.log('ALBUM:', a.id, '|', a.title, '|', a.artist, '|', a.year, '|', a.songCount, '|', (a.thumbnail || '').slice(0, 60));
}

// Probe B: album tracklist for the first album hit.
const firstAlbum = (data.albums || [])[0];
if (firstAlbum) {
  const albumRes = await handleJioSaavnAlbum(
    new Request('http://localhost/api/jiosaavn-album?id=' + encodeURIComponent(firstAlbum.id))
  );
  const albumData = await albumRes.json();
  console.log('ALBUM STATUS', albumRes.status);
  console.log('ALBUM TITLE', albumData.album?.title, '| TRACKS', (albumData.songs || []).length);
  for (const s of (albumData.songs || []).slice(0, 5)) {
    console.log('TRACK:', s.trackName, '|', s.artistName, '|', s.streamUrl ? 'stream' : 'NOSTREAM');
  }
}

