# Frontend-only on-demand playback

On-demand search calls the YouTube Data API directly from the browser. No separate backend or API proxy is required. Playback uses YouTube's embedded IFrame player.

## Configure the YouTube API key

1. In Google Cloud Console, create/select a project and enable **YouTube Data API v3**.
2. Create an API key. Restrict it to **YouTube Data API v3** and to the HTTP referrers for this site, including the production domain and any Cloudflare Pages preview domain you use.
3. Put the key in `youtube-api-config.js` as the value of `window.THAALAM_YOUTUBE_API_KEY`.
4. Deploy the static site to Cloudflare Pages.

The browser key is visible to site visitors by design, so the Google Cloud restrictions are important. YouTube's default quota allows 100 `search.list` requests per day. Search results are cached in the browser for six hours to reduce repeat requests.

## Local development

Run `npm run dev`. Vite serves the frontend at its local development URL. On-demand YouTube search requires a configured API key.
