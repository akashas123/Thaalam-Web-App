import { defineConfig } from 'vite';
import { handleJioSaavnAutoplay, handleJioSaavnSearch, handleJioSaavnSong } from './jiosaavn-search.mjs';

export default defineConfig({
  plugins: [{
    name: 'local-jiosaavn',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        const handlers = {
          '/api/jiosaavn-search': handleJioSaavnSearch,
          '/api/jiosaavn-autoplay': handleJioSaavnAutoplay,
          '/api/jiosaavn-song': handleJioSaavnSong
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
