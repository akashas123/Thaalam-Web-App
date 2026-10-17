import { writeFileSync } from 'node:fs';
import { handleJioSaavnSearch } from './jiosaavn-search.mjs';

const queries = ['pop', 'english', 'international hits', 'top english songs', 'pop hits', 'english pop hits'];
const out = [];
for (const q of queries) {
  const res = await handleJioSaavnSearch(
    new Request('http://localhost/api/jiosaavn-search?q=' + encodeURIComponent(q) + '&limit=25')
  );
  const data = await res.json();
  const results = data.results || [];
  const titleArtist = new Set(results.map((s) => `${s.title}|${s.artist}`.toLowerCase()));
  const thumbs = new Set(results.map((s) => s.thumbnail).filter(Boolean));
  out.push(`q="${q}" -> total ${results.length} | unique songs ${titleArtist.size} | unique thumbs ${thumbs.size} | status ${res.status}`);
  for (const s of results.slice(0, 6)) out.push(`    ${String(s.title).slice(0, 40)} | ${String(s.artist).slice(0, 28)} | ${s.thumbnail ? s.thumbnail.slice(-32) : 'NO-THUMB'}`);
}
writeFileSync('_probe_intl.txt', out.join('\n'));
console.log('done');
