# On-demand playback

On-demand search uses YouTube Music's undocumented web search endpoint through a same-origin route. Search returns public video IDs; playback uses YouTube's embedded IFrame player. This avoids a project-owned YouTube Data API key and its daily search quota. The search endpoint is unofficial and can change without notice.

## Cloudflare Pages

For Git integration or a Wrangler deployment, Cloudflare Pages discovers `functions/api/youtube-search.js` and serves it at `/api/youtube-search`.

For dashboard drag-and-drop Direct Upload, include the root `_worker.js` file with the static assets. It handles `/api/youtube-search` and forwards all other requests to Pages static assets. Cloudflare supports `_worker.js` with Direct Upload; it does not compile a `/functions` directory in drag-and-drop uploads.

## Local development

Run `npm run dev`. The Vite middleware in `vite.config.mjs` exposes the same `/api/youtube-search` route on the local origin, so the browser uses the same player flow at `http://localhost:5173` and in production.
