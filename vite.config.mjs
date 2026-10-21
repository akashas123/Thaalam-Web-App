import { defineConfig } from 'vite';
import { handleAlbum, handleAutoplay, handleSearch, handleSong } from './music-api.mjs';

export default defineConfig({
  plugins: [{
    name: 'local-music-provider',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (pathname === '/api/ratings') {
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: 'Ratings database is only available in the Cloudflare runtime.' }));
          return;
        }
        const handlers = {
          '/api/music-search': handleSearch,
          '/api/music-album': handleAlbum,
          '/api/music-autoplay': handleAutoplay,
          '/api/music-song': handleSong
        };
        const handler = handlers[pathname];
        if (!handler) {
          next();
          return;
        }
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Method not allowed.' }));
          return;
        }
        const url = new URL(request.url, 'http://localhost:5173');
        const result = await handler(new Request(url));
        response.statusCode = result.status;
        result.headers.forEach((value, key) => response.setHeader(key, value));
        response.end(await result.text());
      });
    }
  }]
});
