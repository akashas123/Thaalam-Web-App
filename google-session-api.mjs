const SESSION_COOKIE = 'thaalam_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

function readSessionCookie(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const value = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : '';
}

async function digestSessionToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function makeSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sessionCookie(token, request, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function isSameOriginRequest(request) {
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin &&
    request.headers.get('X-Requested-With') === 'XMLHttpRequest');
}

export async function getSessionUser(request, env) {
  if (!env.DB) return null;
  const token = readSessionCookie(request);
  if (!token) return null;
  try {
    const sessionHash = await digestSessionToken(token);
    const result = await env.DB.prepare(`
      SELECT user_id, name, email, picture
      FROM auth_sessions
      WHERE session_hash = ? AND expires_at > unixepoch()
    `).bind(sessionHash).first();
    if (!result?.user_id) return null;
    await env.DB.prepare('UPDATE auth_sessions SET expires_at = unixepoch() + ? WHERE session_hash = ?')
      .bind(SESSION_TTL_SECONDS, sessionHash).run();
    return { sub: result.user_id, name: result.name || '', email: result.email || '', picture: result.picture || '' };
  } catch {
    return null;
  }
}

export async function handleGoogleSession(request, env) {
  if (!env.DB) return Response.json({ error: 'Session storage is unavailable.' }, { status: 503 });

  if (request.method === 'GET') {
    const user = await getSessionUser(request, env);
    if (!user) {
      return Response.json({ error: 'No active session.' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie('', request, 0) }
      });
    }
    const token = readSessionCookie(request);
    return Response.json({ user }, {
      headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie(token, request) }
    });
  }

  if (request.method === 'DELETE') {
    if (!isSameOriginRequest(request)) return Response.json({ error: 'Invalid request.' }, { status: 403 });
    const token = readSessionCookie(request);
    if (token) {
      try {
        await env.DB.prepare('DELETE FROM auth_sessions WHERE session_hash = ?')
          .bind(await digestSessionToken(token)).run();
      } catch { /* Clear the browser session even if its row was already removed. */ }
    }
    return Response.json({ ok: true }, {
      headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionCookie('', request, 0) }
    });
  }

  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  if (!isSameOriginRequest(request)) return Response.json({ error: 'Invalid request.' }, { status: 403 });
  const authorization = request.headers.get('Authorization') || '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return Response.json({ error: 'Google sign-in is required.' }, { status: 401 });

  let user;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) return Response.json({ error: 'Google sign-in expired.' }, { status: 401 });
    user = await response.json();
  } catch {
    return Response.json({ error: 'Google sign-in could not be verified.' }, { status: 502 });
  }
  if (typeof user.sub !== 'string' || !user.sub || user.email_verified === false) {
    return Response.json({ error: 'Google account could not be verified.' }, { status: 401 });
  }

  const token = makeSessionToken();
  const sessionHash = await digestSessionToken(token);
  try {
    await env.DB.prepare(`
      INSERT INTO auth_sessions (session_hash, user_id, name, email, picture, expires_at)
      VALUES (?, ?, ?, ?, ?, unixepoch() + ?)
    `).bind(sessionHash, user.sub, user.name || '', user.email || '', user.picture || '', SESSION_TTL_SECONDS).run();
  } catch {
    return Response.json({ error: 'Could not save the sign-in session.' }, { status: 503 });
  }

  return Response.json({
    user: { sub: user.sub, name: user.name || '', email: user.email || '', picture: user.picture || '' }
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionCookie(token, request)
    }
  });
}
