// What this Worker is allowed to talk to, and who is allowed to ask it.
//
// SECURITY, stated plainly: a CORS proxy that forwards to an arbitrary URL is a
// genuinely harmful thing to put on the internet. It lets anyone use your
// infrastructure to bypass other sites' CORS protections, hammer third parties
// under your name, and reach hosts they otherwise couldn't (SSRF). This proxy
// is therefore built so that an arbitrary URL is *not expressible*:
//
//   - The client names an upstream by KEY (`/api/yahoo/...`), never by URL.
//     There is no `?url=` parameter to abuse — the destination host is chosen
//     from the table below and can only ever be one of these.
//   - Only the paths each upstream actually needs are reachable.
//   - Only our own origins may call it, so it isn't a free proxy for the web.
//
// Keep all four of those properties if you touch this file.

export interface Upstream {
  origin: string;
  /** Only paths starting with one of these are proxied. */
  allowedPathPrefixes: string[];
  /** Whether an Authorization header from the caller is passed upstream. */
  forwardAuthorization: boolean;
}

export const UPSTREAMS: Record<string, Upstream> = {
  // Yahoo's Fantasy API sends no CORS headers at all, on the endpoint or on its
  // preflight — the reason this Worker exists. Requires an OAuth bearer token.
  yahoo: {
    origin: 'https://fantasysports.yahooapis.com',
    allowedPathPrefixes: ['/fantasy/v2/'],
    forwardAuthorization: true,
  },
  // ESPN already allows browser calls, so this is not needed to read public
  // leagues. It's here for the private-league case, where the browser will not
  // attach another domain's cookies for us.
  espn: {
    origin: 'https://lm-api-reads.fantasy.espn.com',
    allowedPathPrefixes: ['/apis/v3/games/ffl/'],
    forwardAuthorization: true,
  },
};

/** Origins permitted to use this Worker. Anything else gets no CORS headers. */
export const ALLOWED_ORIGINS = [
  'https://garrett-pdx.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}

export interface ResolvedTarget {
  url: string;
  upstream: Upstream;
}

/**
 * Turn `/api/<key>/<path>` into a concrete upstream URL, or null if it isn't
 * one this Worker will make.
 *
 * Rejecting rather than sanitising is deliberate: every "clean up the path and
 * proceed" proxy eventually gets walked out of its own directory. `new URL()`
 * normalises `..` and encoded separators before the prefix check, so a path
 * that escapes its allowed prefix simply fails to match and is refused.
 */
export function resolveTarget(pathname: string, search: string): ResolvedTarget | null {
  const match = /^\/api\/([a-z0-9-]+)(\/.*)?$/i.exec(pathname);
  if (!match) return null;
  const upstream = UPSTREAMS[match[1].toLowerCase()];
  if (!upstream) return null;

  const rest = match[2] ?? '/';
  let url: URL;
  try {
    url = new URL(rest + search, upstream.origin);
  } catch {
    return null;
  }
  // A relative path can't change host, but check anyway: this is the invariant
  // the whole design rests on, and it costs one comparison.
  if (url.origin !== upstream.origin) return null;
  if (!upstream.allowedPathPrefixes.some((p) => url.pathname.startsWith(p))) return null;

  return { url: url.toString(), upstream };
}
