import { writeFileSync } from 'node:fs';
import { handleJioSaavnSearch } from './jiosaavn-search.mjs';

// Mirrors searchGenreChart() exactly: limit = min(25, GENRE_CHART_LIMIT + 4),
// dedupe by normalized title+artist, stop at GENRE_CHART_LIMIT (21).
const GENRE_CHART_LIMIT = 21;
const genreFeedIds = {
  international: 'english songs',
  hindi: 'hindi',
  malayalam: 'malayalam',
  tamil: 'tamil'
};

const out = [];
for (const [key, query] of Object.entries(genreFeedIds)) {
  const limit = Math.min(25, GENRE_CHART_LIMIT + 4);
  const res = await handleJioSaavnSearch(
    new Request('http://localhost/api/jiosaavn-search?q=' + encodeURIComponent(query) + '&limit=' + limit)
  );
  const data = await res.json();
  const results = data.results || [];

  const seen = new Set();
  const songs = [];
  for (const song of results) {
    const mapped = {
      trackId: song.id,
      trackName: song.title,
      artistName: song.artist,
      artworkUrl100: song.thumbnail,
      streamUrl: song.streamUrl,
      primaryGenreName: query
    };
    const key2 = `${mapped.trackName || ''}|${mapped.artistName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key2)) continue;
    seen.add(key2);
    songs.push(mapped);
    if (songs.length >= GENRE_CHART_LIMIT) break;
  }

  const withArt = songs.filter((s) => s.artworkUrl100).length;
  const withStream = songs.filter((s) => s.streamUrl).length;
  const all320 = songs.every((s) => !s.streamUrl || s.streamUrl.includes('_320.'));
  const uniqueIds = new Set(songs.map((s) => s.trackId)).size;
  out.push(`${key.padEnd(14)} q="${query}" -> ${String(songs.length).padStart(2)}/${GENRE_CHART_LIMIT} cards | unique ids ${uniqueIds} | art ${withArt} | stream ${withStream} | 320 ${all320 ? 'YES' : 'NO'}`);
  for (const s of songs.slice(0, 4)) out.push(`      ${String(s.trackName).slice(0, 44)} | ${String(s.artistName || '').slice(0, 30)}`);
}
writeFileSync('_genre_report.txt', out.join('\n'));
console.log('done');
