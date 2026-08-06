// Read/write the league's shared keeper picks in a GitHub Gist.
//
// This is the one place the app talks to something other than Sleeper and our
// own static assets, and the one place it *writes* anywhere. A gist is used
// because keeper picks have to be visible to every manager on their own device,
// which a localStorage-only app can't do, and because it needs no server to run
// (see CLAUDE.md's "Shared keeper picks" for the full rationale and the
// security tradeoff).
//
// SECURITY, stated plainly: the write token ships inside the public JS bundle.
// There is no way around that in a static site with no backend — anyone who
// opens devtools on the deployed page can read it. Consequences to accept
// before using this: the token must be a fine-grained PAT with *gists write and
// nothing else*, on an account whose gists are all disposable, and anyone who
// finds it can overwrite this gist. Gist revision history makes that recoverable
// rather than destructive. Reads are unauthenticated (public gists don't need a
// token), so a deploy with no token configured still shows everyone's picks —
// it just can't save.
import { SharedKeepersSchema, type SharedKeepers } from './schemas';
import { EMPTY_SHARED_KEEPERS } from '../domain/keeperShare';

const GIST_API = 'https://api.github.com/gists';
const KEEPERS_FILENAME = 'keepers.json';

/** Who to chase when the shared list's write token needs renewing. */
export const LEAGUE_ADMIN = 'Garrett';

/**
 * GitHub rejected the built-in token — almost always because the PAT expired
 * (fine-grained gist tokens have a maximum lifetime, so this is a *when*, not
 * an *if*). Distinct from an ordinary network failure because it's neither
 * transient nor worth retrying: nothing will save again until the token is
 * replaced and the site redeployed.
 */
export class GistAuthError extends Error {
  constructor() {
    super(
      `The league’s shared keeper list is read-only right now — its access token has expired. ` +
        `Your picks are safe in this browser. Reach out to ${LEAGUE_ADMIN} to renew it, then save again.`,
    );
    this.name = 'GistAuthError';
  }
}

// Latches once GitHub turns the token down, so the app stops presenting save
// controls that cannot possibly work and every read afterwards skips straight
// to the unauthenticated path.
let tokenRejected = false;

export function isTokenRejected(): boolean {
  return tokenRejected;
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

// Configured only at build time (GitHub Actions for the deploy, a local
// .env.local for development). There is deliberately no in-app field for
// either value: a token box in the UI invites pasting a credential into a page
// that already ships one, and a per-browser gist override just splits the
// league across two lists that look identical. One league, one build, one
// shared list.
function envValue(key: string): string {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function gistId(): string {
  return envValue('VITE_KEEPER_GIST_ID');
}
export function gistToken(): string {
  return envValue('VITE_KEEPER_GIST_TOKEN');
}
/** Shared picks can be shown at all. */
export function canReadShared(): boolean {
  return !!gistId();
}
/** Shared picks can be saved from this browser. */
export function canWriteShared(): boolean {
  return !!gistId() && !!gistToken() && !tokenRejected;
}

function headers(auth: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (auth) h.Authorization = `Bearer ${gistToken()}`;
  return h;
}

/**
 * The league's shared picks, or an empty doc when the gist has no keepers file
 * yet (the normal state before anyone's first save).
 */
export async function fetchSharedKeepers(): Promise<SharedKeepers> {
  // Cache-bust: GitHub serves gist reads through a CDN, and a manager checking
  // for someone else's just-saved picks must not get a cached copy.
  const url = `${GIST_API}/${gistId()}?t=${Date.now()}`;
  const withToken = !!gistToken() && !tokenRejected;
  let res = await fetch(url, { headers: headers(withToken), cache: 'no-store' });

  // An expired token must not cost the league its *read* access. The gist is
  // fetchable by anyone holding its ID, so drop the bad credential and ask
  // again unauthenticated — everyone keeps seeing the locked-in picks, and only
  // saving is lost until the token is renewed.
  if (!res.ok && withToken && isAuthFailure(res.status)) {
    tokenRejected = true;
    res = await fetch(url, { headers: headers(false), cache: 'no-store' });
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} reading shared keepers`);
  const body = (await res.json()) as { files?: Record<string, { content?: string } | null> };
  const raw = body.files?.[KEEPERS_FILENAME]?.content;
  if (!raw || !raw.trim()) return EMPTY_SHARED_KEEPERS;
  return SharedKeepersSchema.parse(JSON.parse(raw));
}

export async function writeSharedKeepers(doc: SharedKeepers): Promise<void> {
  const res = await fetch(`${GIST_API}/${gistId()}`, {
    method: 'PATCH',
    headers: { ...headers(true), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: { [KEEPERS_FILENAME]: { content: JSON.stringify(doc, null, 2) } },
    }),
  });
  if (res.ok) return;
  if (isAuthFailure(res.status)) {
    tokenRejected = true;
    throw new GistAuthError();
  }
  throw new Error(`HTTP ${res.status} saving shared keepers`);
}
