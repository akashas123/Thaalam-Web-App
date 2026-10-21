import { handleGoogleSession } from '../../../google-session-api.mjs';

export async function onRequest({ request, env }) {
  try {
    return await handleGoogleSession(request, env);
  } catch {
    return Response.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
  }
}
