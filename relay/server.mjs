import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8788);
const token = process.env.JIOSAAVN_RELAY_TOKEN || '';
const upstream = 'https://www.jiosaavn.com/api.php';
const maxResponseBytes = 5 * 1024 * 1024;

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function hasValidToken(candidate) {
  if (!token || !candidate) return false;
  const expected = Buffer.from(token);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

  if (requestUrl.pathname === '/health') {
    return json(response, 200, { ok: true });
  }
  if (requestUrl.pathname !== '/api.php') {
    return json(response, 404, { error: 'Not found.' });
  }
  if (request.method !== 'GET') {
    return json(response, 405, { error: 'Method not allowed.' });
  }
  if (request.url.length > 4096) {
    return json(response, 414, { error: 'Request URL is too long.' });
  }
  if (!hasValidToken(request.headers['x-relay-token'])) {
    return json(response, 401, { error: 'Unauthorized.' });
  }

  const target = new URL(upstream);
  target.search = requestUrl.search;
  try {
    const upstreamResponse = await fetch(target, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = await upstreamResponse.arrayBuffer();
    if (body.byteLength > maxResponseBytes) {
      return json(response, 502, { error: 'JioSaavn response exceeded the relay limit.' });
    }
    response.writeHead(upstreamResponse.status, {
      'content-type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    response.end(Buffer.from(body));
  } catch {
    json(response, 502, { error: 'JioSaavn is temporarily unavailable.' });
  }
});

if (!token) {
  console.error('Set JIOSAAVN_RELAY_TOKEN before starting the relay.');
  process.exit(1);
}

server.listen(port, '127.0.0.1', () => {
  console.log(`JioSaavn relay listening on 127.0.0.1:${port}`);
});
