import { defineConfig } from 'vite';
import { Readable } from 'node:stream';
import { handleAlbum, handleAutoplay, handleMusicStream, handleSearch, handleSong } from './music-api.mjs';

export default defineConfig({
  plugins: [{
    name: 'local-music-provider',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (pathname === '/api/auth/session') {
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: 'Account sessions are only available in the Cloudflare runtime.' }));
          return;
        }
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
          '/api/music-song': handleSong,
          '/api/music-stream': handleMusicStream
        };
        const handler = handlers[pathname];
        if (!handler) {
          next();
          return;
        }
        if (!['GET', 'HEAD'].includes(request.method)) {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Method not allowed.' }));
          return;
        }
        const url = new URL(request.url, 'http://localhost:5173');
        const result = await handler(new Request(url, {
          method: request.method,
          headers: request.headers
        }));
        response.statusCode = result.status;
        result.headers.forEach((value, key) => response.setHeader(key, value));
        if (result.body) Readable.fromWeb(result.body).pipe(response);
        else response.end();
      });
    }
  }]
});
