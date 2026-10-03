import { defineConfig } from 'vite';
import { handleYouTubeMusicSearch } from './youtube-music-search.mjs';

export default defineConfig({
  plugins: [{
    name: 'local-youtube-music-search',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/api/youtube-search') {
          next();
          return;
        }
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Method not allowed.' }));
          return;
        }
        const url = new URL(request.url, 'http://localhost:5173');
        const result = await handleYouTubeMusicSearch(new Request(url));
        response.statusCode = result.status;
        result.headers.forEach((value, key) => response.setHeader(key, value));
        response.end(await result.text());
      });
    }
  }]
});
