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

// Runtime overrides, so the sync can be pointed at a personal gist (or turned
// on at all) without a rebuild — set from the Settings tab.
export const LS_GIST_ID = 'kdb_gist_id';
export const LS_GIST_TOKEN = 'kdb_gist_token';

function configValue(lsKey: string, envKey: string): string {
  const local = localStorage.getItem(lsKey);
  if (local && local.trim()) return local.trim();
  const fromEnv = import.meta.env[envKey];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

export function gistId(): string {
  return configValue(LS_GIST_ID, 'VITE_KEEPER_GIST_ID');
}
export function gistToken(): string {
  return configValue(LS_GIST_TOKEN, 'VITE_KEEPER_GIST_TOKEN');
}
/** Shared picks can be shown at all. */
export function canReadShared(): boolean {
  return !!gistId();
}
/** Shared picks can be saved from this browser. */
export function canWriteShared(): boolean {
  return !!gistId() && !!gistToken();
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
  const id = gistId();
  // Cache-bust: GitHub serves gist reads through a CDN, and a manager checking
  // for someone else's just-saved picks must not get a cached copy.
  const res = await fetch(`${GIST_API}/${id}?t=${Date.now()}`, {
    headers: headers(!!gistToken()),
    cache: 'no-store',
  });
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
  if (!res.ok) throw new Error(`HTTP ${res.status} saving shared keepers`);
}
