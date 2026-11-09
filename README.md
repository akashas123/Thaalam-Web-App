## Recommendation engine

The recommendation engine is a compact, heuristic system. It is deliberately transparent

The recommendation philosophy is controlled relevance with bounded repetition:

1. Completed plays build positive artist and genre affinity.
2. Early manual skips create negative signals. The skipped recording is strongly deprioritised and its artists receive a smaller negative weight.
3. Candidate tracks are ordered to avoid nearby album and artist repetition.
4. A stable device, day, and context seed gives each listener repeatable daily variation.
5. Daily Mixes use completed listening only, so opening or sampling a song does not change mix eligibility.
6. Mix sessions focus on discovery by avoiding tracks the listener has already completed or skipped.

The engine is exposed through the Thaalam recommendation interface. It provides independent operations for deterministic seeds, seeded shuffling, diversity ordering, behavioural personalisation, daily mix planning, artist discovery, and per-mix session sequencing. The application owns catalog retrieval, metadata validation, playback, queue assembly, and UI rendering.

### Personalisation semantics

Personalisation combines positive play affinity with negative skip affinity. Artist plays increase relevance, skipped artists reduce it, and an exact track skip receives the strongest penalty. A skip is recorded only when the listener manually moves forward before the final 30% of a song. This avoids interpreting normal end-of-track navigation as negative feedback.

The system does not permanently block music from a single skip. Instead, it pushes that recording and closely associated artist results lower in future personalised ordering. This preserves room for rediscovery while making the experience respond to clear listening behaviour.

### Daily Mixes and discovery

A genre becomes eligible for a genre-specific mix after three completed plays. Genre ranking gives more weight to recent completions, while the daily plan keeps Mix numbering stable for the rest of that day. The first eligible day presents one broad Thaalam Mix across the listener's played genres; later days can show genre-specific mixes based on the saved daily ranking.

Every mix session changes its discovery sequence. Previously completed and skipped tracks are excluded, and fresh artist searches are preferred before falling back to the daily catalogue. The result is designed to offer similar music and artists without repeating the same listening history.

### Diversity and repeat control

The queue builder uses soft diversity rules. It tries to avoid the same album within the previous five selections and the same artist within the previous two selections. When a candidate pool is small, these restrictions relax gracefully so playback never becomes impossible.

The recommendation system is deterministic only when its input order, metadata, device identifier, day, and stored state are the same. It uses deterministic pseudo-randomisation for repeatable variation, not cryptographic randomness.

## Local storage and performance

Listening state is stored locally to keep the app responsive and private by default. Background maintenance runs only when the browser is idle, so cleanup does not interrupt animation or playback.

To keep the application lightweight, the app limits playback history, completed taste records, skip signals, cached search results, metadata, artist information, genre results, and stream-duration cache entries. Favourites, ratings, and account data are not removed by this maintenance process.

The current retention targets are:

- Playback history: 160 tracks.
- Completed taste profile: 180 tracks.
- Skip profile: 100 tracks.
- Search cache: 24 recent entries, with expired entries removed.
- Track duration cache: 400 entries.
- Song metadata cache: 350 entries.
- Artist metadata cache: 220 entries.

## Architecture

The application is a static HTML, CSS, and JavaScript client supported by Cloudflare Pages and Worker routes. The main browser application renders the Home, Search, Library, Now Playing. The recommendation engine remains in a separate module so personalisation and mix logic stay isolated from rendering and player controls.

On-demand search, stream resolution, and autoplay are provided through same-origin music routes. The browser plays returned CDN streams through HTML audio, allowing normal range requests and seeking. When direct catalogue access is unavailable from Cloudflare, an optional India-hosted relay can forward only the catalogue requests; audio continues to stream from the music CDN.

The service worker caches the application shell and versioned static assets. Updates are silent: an active listening session is not force-refreshed when a deployment happens. The next app launch receives the new version.

## Google sign-in and ratings

Google sign-in uses Google Identity Services. Configure a Web OAuth client in Google Cloud Console and add the deployed origin plus the local development origin as authorised JavaScript origins. Put only the public client identifier in the client configuration; never add a client secret to this static application.

After sign-in, a short-lived Google token creates a persistent, HttpOnly app session. The session is stored in Cloudflare D1 and can last up to one year. The browser does not need to retain the Google access token to make ratings requests.

Like and dislike ratings can sync across browsers through the Google account. If the backend is not configured, local device ratings and liked songs continue to work in that browser.

## Cloudflare deployment

Cloudflare Pages serves the static app and the API routes for music search, song resolution, autoplay, ratings, and authentication sessions. A Cloudflare D1 database is required for persistent sessions and cross-browser ratings.

For a new D1 database, apply the migrations in the migrations folder in order, including the Google session migration. Bind the database to the deployment under the name `DB`. Existing databases that use an old video identity column should be migrated to the track identity schema before enabling synced ratings.

Git-integrated Pages deployments use the routes in the functions folder. Dashboard Direct Upload deployments use the root worker file together with the static assets; that worker forwards application requests to the same music, rating, and authentication handlers.

Optional relay configuration is supported through the JioSaavn relay URL and relay token runtime variables. Leave them unset for local development or when direct Cloudflare outbound catalogue requests work.

## Local development

Start the local development server with the project's development script. The local Vite middleware exposes the same music routes on the local origin, allowing the browser player to use the same flow as production.

The local server does not provide a D1 binding. In local development, ratings and persistent account sessions therefore return setup responses, while local liked songs and playback features remain available through browser storage.

## Engineering boundaries and future direction

The current engine is a practical heuristic foundation. It does not yet use canonical artist or track identifiers, semantic audio similarity, collaborative filtering, timestamp-aware affinity decay, or learned ranking coefficients. These are deliberate boundaries rather than hidden behaviour.

The highest-value next steps are stronger metadata identity, safe storage migrations, validated recommendation inputs, completion-aware event weights, measured recommendation quality, and richer candidate sources. Any future recommendation work should preserve the current principles: explainable behaviour, listener control, graceful fallbacks, predictable client performance, and respect for local listening data.

## Privacy and security

The recommendation module does not transmit listening history by itself. The surrounding application should minimise data collection, define retention policies, protect account sessions, and provide an understandable way for listeners to clear local data.

Device-derived seeds are useful for a stable experience but are not secrets. Browser storage is mutable and should be treated as potentially incomplete or corrupted. Recommendation identifiers, track names, and artist text must never be trusted as HTML or security-sensitive values.
