import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { handleAlbum, handleAutoplay, handleSearch, handleSong } from './music-api.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const classicAppFiles = [
  '_worker.js',
  'style.css',
  'script.js',
  'audio-recovery.js',
  'marquee.js',
  'media-metadata.js',
  'player-controls.js',
  'ondemand-player.js',
  'lyrics.js',
  'google-auth-config.js',
  'sw.js',
  'manifest.json',
  'album-placeholder.svg',
  'icon-192.png',
  'icon-512.png',
  'logo.png'
];

export default defineConfig({
  build: { outDir: 'dist' },
  plugins: [
    {
      name: 'local-music-provider',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const pathname = request.url?.split('?')[0];
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
    },
    {
      name: 'copy-classic-app-files',
      apply: 'build',
      closeBundle() {
        const outputDir = resolve(projectRoot, 'dist');
        for (const file of classicAppFiles) {
          copyFileSync(resolve(projectRoot, file), resolve(outputDir, file));
        }
      }
    }
  ]
});
