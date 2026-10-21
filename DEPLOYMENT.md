# On-demand playback

## Google sign-in

Google sign-in uses Google Identity Services. Create an OAuth 2.0 client ID for a
Web application in Google Cloud Console, add the deployed site origin and
`http://localhost:5173` as Authorized JavaScript origins, then set the client ID
in `google-auth-config.js`. The client ID is public configuration; do not put a
client secret in this static app. Enable the Google Identity Services client for
the OAuth consent screen and publish or add test users as appropriate. Until a
client ID is configured, the sign-in button stays disabled and explains why.

Google sign-in uses a short-lived access token once to create a persistent,
HttpOnly app session. The session is stored in D1 and lasts up to one year, so
reopening the app does not require another Google sign-in. The browser does not
need to retain the Google access token for ratings requests.

## Cross-browser song ratings

Like and dislike ratings sync by Google account through the `/api/ratings` Worker
route. Configure a Cloudflare D1 database before deploying this feature:

1. Create a D1 database in Cloudflare and apply the migrations in order, including
   `0004_google_sessions.sql` to enable persistent app sessions. If the existing
   ratings table already has `album` but still has `video_id`, rename that column
   to `track_id` with `ALTER TABLE user_ratings RENAME COLUMN video_id TO track_id;`.
   Fresh databases should apply `0003_user_ratings_track_identity.sql`. Use
   `wrangler d1 execute <database-name> --remote --file=migrations/<migration-file>`.
2. In the Pages project's **Settings > Functions > D1 database bindings**, add a
   binding named `DB` and select that database. The root `_worker.js` direct-upload
   worker reads the same `DB` binding. Git-integrated Pages deployments use the
   `functions/api/ratings.js` route with that same binding.
3. Deploy the site and test by signing into the same Google account in two
   browsers. Existing ratings on a browser are imported the first time it syncs.

Until the `DB` binding and session migration are configured, the API cannot
create a persistent session and account ratings remain unavailable. Device
ratings continue to work locally in that browser.

On-demand search, stream resolution, and autoplay use JioSaavn's undocumented web API through same-origin routes (`/api/music-search`, `/api/music-song`, `/api/music-autoplay`). The API blocks browser CORS, so all calls are proxied server-side; song media URLs arrive DES-ECB encrypted (key `38346591`) and are decrypted in plain JS before being returned. Playback streams the direct CDN audio through an HTML5 `<audio>` element (the CDN answers Range requests, so seeking works). Autoplay creates a new radio station from each played track and filters out the current artist and album, then requests another station as playback advances. These endpoints are undocumented and can change without notice.

If Cloudflare's outbound requests to JioSaavn are blocked, the Worker can send
catalogue API requests through the optional India hosted relay in `relay/`.
Deploy that service and set `JIOSAAVN_RELAY_URL` and the secret
`JIOSAAVN_RELAY_TOKEN` in the Pages Functions or direct-upload Worker runtime.
The relay only forwards to JioSaavn's fixed API host; audio playback still
streams directly from JioSaavn's CDN. With these variables unset, local
development continues to call JioSaavn directly.

## Cloudflare Pages

For Git integration or a Wrangler deployment, Cloudflare Pages discovers the files in `functions/api/` and serves `/api/music-search`, `/api/music-song`, `/api/music-autoplay`, `/api/ratings`, and `/api/auth/session`.

For dashboard drag-and-drop Direct Upload, include the root `_worker.js` file with the static assets. It handles `/api/music-search`, `/api/music-song`, `/api/music-autoplay`, `/api/ratings`, and `/api/auth/session`, then forwards all other requests to Pages static assets. Cloudflare supports `_worker.js` with Direct Upload; it does not compile a `/functions` directory in drag-and-drop uploads.

## Local development

Run `npm run dev`. The Vite middleware in `vite.config.mjs` exposes the same `/api/music-*` routes on the local origin, so the browser uses the same player flow at `http://localhost:5173` and in production.
The local Vite server has no D1 binding, so `/api/ratings` and `/api/auth/session`
return setup responses; liked songs remain visible from browser storage. Account
ratings and persistent sign-in work through Cloudflare Pages or Worker after the
`DB` binding and migrations are configured.
