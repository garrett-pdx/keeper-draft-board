// Cloudflare Worker: a narrowly-scoped CORS proxy for fantasy platforms whose
// APIs a browser cannot call directly.
//
// Exists because CORS — not authentication — is what blocks every platform
// except Sleeper. Yahoo's Fantasy API sends no CORS headers on the endpoint or
// its preflight, so even a perfectly valid OAuth token is unusable from the
// browser. See CLAUDE.md's "Backend (Cloudflare Worker)".
//
// It deliberately does very little: no database, no user data at rest, no
// business logic. Read src/upstreams.ts before changing anything here — the
// security properties live there.
import { isAllowedOrigin, resolveTarget } from './upstreams';

/** Headers worth passing upstream. Everything else is dropped. */
const FORWARDABLE_REQUEST_HEADERS = ['accept', 'x-fantasy-filter'];

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept, X-Fantasy-Filter',
    'Access-Control-Max-Age': '86400',
    // Origin decides the response, so caches must not serve one origin's
    // response to another.
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(origin && isAllowedOrigin(origin) ? corsHeaders(origin) : {}),
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true }, 200, origin);
    }

    // No CORS headers for an origin we don't know, which is what stops this
    // being a proxy anyone on the web can point at Yahoo.
    if (!isAllowedOrigin(origin)) {
      return json({ error: 'origin not allowed' }, 403, null);
    }
    const allowedOrigin = origin as string;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, allowedOrigin);
    }

    const target = resolveTarget(url.pathname, url.search);
    if (!target) {
      return json({ error: 'no such upstream, or path not allowed' }, 404, allowedOrigin);
    }

    const headers = new Headers();
    for (const name of FORWARDABLE_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (target.upstream.forwardAuthorization) {
      const auth = request.headers.get('Authorization');
      if (auth) headers.set('Authorization', auth);
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(target.url, { method: 'GET', headers });
    } catch {
      // 502, not 500: the failure is upstream, and the client should be able to
      // tell "Yahoo is down" from "the proxy is broken".
      return json({ error: 'upstream request failed' }, 502, allowedOrigin);
    }

    // Rebuild rather than pass through: upstream CORS headers (or their absence)
    // must not leak into a response we are the one vouching for.
    const out = new Headers(corsHeaders(allowedOrigin));
    const contentType = upstreamResponse.headers.get('Content-Type');
    if (contentType) out.set('Content-Type', contentType);
    out.set('Cache-Control', 'no-store');

    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: out });
  },
};
