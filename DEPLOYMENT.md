# On-demand playback

On-demand search and autoplay use YouTube Music's undocumented web endpoints through same-origin routes. Search returns public video IDs; playback uses YouTube's embedded IFrame player. Autoplay reads YouTube Music's generated next queue and keeps only Topic-style audio tracks. These endpoints avoid a project-owned YouTube Data API key and its daily search quota, but are unofficial and can change without notice.

## Cloudflare Pages

For Git integration or a Wrangler deployment, Cloudflare Pages discovers the files in `functions/api/` and serves `/api/youtube-search` and `/api/youtube-autoplay`.

For dashboard drag-and-drop Direct Upload, include the root `_worker.js` file with the static assets. It handles `/api/youtube-search` and `/api/youtube-autoplay`, then forwards all other requests to Pages static assets. Cloudflare supports `_worker.js` with Direct Upload; it does not compile a `/functions` directory in drag-and-drop uploads.

## Local development

Run `npm run dev`. The Vite middleware in `vite.config.mjs` exposes the same `/api/youtube-search` route on the local origin, so the browser uses the same player flow at `http://localhost:5173` and in production.
