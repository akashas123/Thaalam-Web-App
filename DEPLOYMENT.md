# On-demand playback

## Google sign-in

Google sign-in uses Google Identity Services. Create an OAuth 2.0 client ID for a
Web application in Google Cloud Console, add the deployed site origin and
`http://localhost:5173` as Authorized JavaScript origins, then set the client ID
in `google-auth-config.js`. The client ID is public configuration; do not put a
client secret in this static app. Enable the Google Identity Services client for
the OAuth consent screen and publish or add test users as appropriate. Until a
client ID is configured, the sign-in button stays disabled and explains why.

Google sign-in provides a short-lived access token for the session. The Cloudflare
Worker verifies it against Google's user-info endpoint before using the Google
account's stable subject ID to read or write ratings. The browser keeps the
access token in session storage, not persistent local storage.

## Cross-browser song ratings

Like and dislike ratings sync by Google account through the `/api/ratings` Worker
route. Configure a Cloudflare D1 database before deploying this feature:

1. Create a D1 database in Cloudflare and apply `migrations/0001_user_ratings.sql`
   with `wrangler d1 execute <database-name> --remote --file=migrations/0001_user_ratings.sql`.
2. In the Pages project's **Settings > Functions > D1 database bindings**, add a
   binding named `DB` and select that database. The root `_worker.js` direct-upload
   worker reads the same `DB` binding. Git-integrated Pages deployments use the
   `functions/api/ratings.js` route with that same binding.
3. Deploy the site and test by signing into the same Google account in two
   browsers. Existing ratings on a browser are imported the first time it syncs.

Until the `DB` binding is configured, the API returns a setup error and ratings
continue to work locally in that browser. Google access tokens last for a limited
time; after expiry, sign in again to resume syncing.

On-demand search and autoplay use YouTube Music's undocumented web endpoints through same-origin routes. Search returns public video IDs; playback uses YouTube's embedded IFrame player. Autoplay reads YouTube Music's generated next queue and keeps only Topic-style audio tracks. These endpoints avoid a project-owned YouTube Data API key and its daily search quota, but are unofficial and can change without notice.

## Cloudflare Pages

For Git integration or a Wrangler deployment, Cloudflare Pages discovers the files in `functions/api/` and serves `/api/youtube-search`, `/api/youtube-autoplay`, and `/api/ratings`.

For dashboard drag-and-drop Direct Upload, include the root `_worker.js` file with the static assets. It handles `/api/youtube-search`, `/api/youtube-autoplay`, and `/api/ratings`, then forwards all other requests to Pages static assets. Cloudflare supports `_worker.js` with Direct Upload; it does not compile a `/functions` directory in drag-and-drop uploads.

## Local development

Run `npm run dev`. The Vite middleware in `vite.config.mjs` exposes the same `/api/youtube-search` route on the local origin, so the browser uses the same player flow at `http://localhost:5173` and in production.
