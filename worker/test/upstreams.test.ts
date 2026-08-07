import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, resolveTarget, UPSTREAMS } from '../src/upstreams';

// These tests are the security boundary, not a formality. The whole design
// rests on "an arbitrary destination is not expressible", so each case below
// pins one way that could stop being true.
describe('resolveTarget', () => {
  it('routes a named upstream to its own origin', () => {
    const t = resolveTarget('/api/yahoo/fantasy/v2/game/nfl', '');
    expect(t?.url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/game/nfl');
  });

  it('keeps the query string, which carries the real request', () => {
    const t = resolveTarget('/api/yahoo/fantasy/v2/game/nfl', '?format=json');
    expect(t?.url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/game/nfl?format=json');
  });

  it('refuses an upstream key it does not know', () => {
    expect(resolveTarget('/api/evil/whatever', '')).toBeNull();
    expect(resolveTarget('/api/', '')).toBeNull();
  });

  it('refuses paths outside what that upstream needs', () => {
    // Reaching the right host is not enough; the path has to be one we serve.
    expect(resolveTarget('/api/yahoo/admin/secrets', '')).toBeNull();
    expect(resolveTarget('/api/espn/apis/v2/something', '')).toBeNull();
  });

  it('cannot be walked out of its allowed prefix with traversal', () => {
    // new URL() normalises `..` before the prefix check, so these resolve to
    // paths that simply don't match and are refused.
    expect(resolveTarget('/api/yahoo/fantasy/v2/../../admin', '')).toBeNull();
    expect(resolveTarget('/api/yahoo/fantasy/v2/%2e%2e/%2e%2e/admin', '')).toBeNull();
  });

  it('cannot be redirected to another host by the path', () => {
    // The classic open-proxy bug: a path that looks absolute. There is no url
    // parameter here, and a relative path cannot change the origin.
    for (const p of [
      '/api/yahoo//evil.example.com/fantasy/v2/',
      '/api/yahoo/https://evil.example.com/fantasy/v2/',
      '/api/yahoo/\\evil.example.com/fantasy/v2/',
    ]) {
      const t = resolveTarget(p, '');
      if (t) expect(new URL(t.url).origin).toBe(UPSTREAMS.yahoo.origin);
    }
  });

  it('ignores a url query parameter entirely', () => {
    // Nothing reads `?url=`; it is carried upstream as an ordinary query param
    // and cannot change the destination.
    const t = resolveTarget('/api/yahoo/fantasy/v2/game/nfl', '?url=https://evil.example.com');
    expect(new URL(t!.url).origin).toBe(UPSTREAMS.yahoo.origin);
  });

  it('refuses anything not under /api/', () => {
    expect(resolveTarget('/fantasy/v2/game/nfl', '')).toBeNull();
    expect(resolveTarget('/', '')).toBeNull();
  });

  it('only forwards Authorization where an upstream actually needs it', () => {
    expect(UPSTREAMS.yahoo.forwardAuthorization).toBe(true);
    // Every upstream must make a deliberate choice rather than inherit one.
    for (const [key, u] of Object.entries(UPSTREAMS)) {
      expect(typeof u.forwardAuthorization, `${key} must declare it`).toBe('boolean');
      expect(u.origin.startsWith('https://'), `${key} must be https`).toBe(true);
      expect(u.allowedPathPrefixes.length, `${key} must restrict paths`).toBeGreaterThan(0);
    }
  });
});

describe('isAllowedOrigin', () => {
  it('accepts our own origins', () => {
    expect(isAllowedOrigin('https://garrett-pdx.github.io')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });

  it('rejects everything else, so this is not a proxy for the web', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });

  it('is not fooled by an origin that merely contains ours', () => {
    expect(isAllowedOrigin('https://garrett-pdx.github.io.evil.com')).toBe(false);
    expect(isAllowedOrigin('https://evil.com?https://garrett-pdx.github.io')).toBe(false);
  });
});
