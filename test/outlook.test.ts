import { describe, it, expect } from 'vitest';
import { outlookFor } from '../src/domain/outlook';

describe('outlookFor', () => {
  const outlookMap = { '3918298': 'Allen enters his age-30 campaign...' };

  it('returns the outlook text for a matched espnId', () => {
    expect(outlookFor(3918298, outlookMap)).toBe('Allen enters his age-30 campaign...');
  });

  it('returns null for a null espnId', () => {
    expect(outlookFor(null, outlookMap)).toBeNull();
  });

  it('returns null for an espnId with no matching outlook', () => {
    expect(outlookFor(9999999, outlookMap)).toBeNull();
  });
});
