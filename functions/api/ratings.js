import { handleRatings } from '../../ratings-api.mjs';

export async function onRequest({ request, env }) {
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }
  try {
    return await handleRatings(request, env);
  } catch {
    return Response.json({ error: 'Ratings storage is temporarily unavailable.' }, { status: 503 });
  }
}
