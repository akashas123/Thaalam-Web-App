import { handleYouTubeMusicNext } from '../../youtube-music-search.mjs';

export function onRequest({ request }) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }
  return handleYouTubeMusicNext(request);
}
