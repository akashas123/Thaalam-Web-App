import { handleAutoplay } from '../../music-api.mjs';

export function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }
  return handleAutoplay(request, env);
}
