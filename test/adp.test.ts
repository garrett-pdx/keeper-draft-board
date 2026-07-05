import { describe, it, expect } from 'vitest';
import { extractAdp } from '../src/domain/adp';

describe('extractAdp', () => {
  it('returns null for empty input', () => {
    expect(extractAdp(null)).toBeNull();
    expect(extractAdp(undefined)).toBeNull();
    expect(extractAdp({})).toBeNull();
  });

  it('prefers the known ADP keys', () => {
    expect(extractAdp({ adp_ppr: 24.3, foo: 1 })).toBe(24.3);
    expect(extractAdp({ adp_dd_ppr: 88 })).toBe(88);
  });

  it('respects the preferred-key ordering', () => {
    // adp_std comes before adp_dd_ppr in the preference list
    expect(extractAdp({ adp_dd_ppr: 88, adp_std: 10 })).toBe(10);
  });

  it('falls back to any positive adp-prefixed key', () => {
    expect(extractAdp({ adp_custom_thing: 45 })).toBe(45);
  });

  it('ignores non-positive and non-numeric values', () => {
    expect(extractAdp({ adp_ppr: 0 })).toBeNull();
    expect(extractAdp({ adp_ppr: -5 })).toBeNull();
    expect(extractAdp({ adp_ppr: 'n/a' })).toBeNull();
  });
});
