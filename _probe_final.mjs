import { writeFileSync } from 'node:fs';
import { handleJioSaavnSearch } from './jiosaavn-search.mjs';

// Mirror searchGenreChart: fetch 25, dedupe title|artist, stop at 21.
const out = [];
for (const q of ['trending english songs']) {
  const res = await handleJioSaavnSearch(
    new Request('http://localhost/api/jiosaavn-search?q=' + encodeURIComponent(q) + '&limit=25')
  );
  const data = await res.json();
  const results = data.results || [];
  const seen = new Set();
  const songs = [];
  for (const s of results) {
    const key = `${s.title}|${s.artist}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(s);
    if (songs.length >= 21) break;
  }
  out.push(`q="${q}" raw ${results.length} -> cards ${songs.length}/21`);
  for (const s of songs) out.push(`    ${String(s.title).slice(0, 42)} | ${String(s.artist).slice(0, 30)} | ${s.thumbnail ? 'art' : 'NOART'}`);
}
writeFileSync('_probe_final.txt', out.join('\n'));
console.log('done');
