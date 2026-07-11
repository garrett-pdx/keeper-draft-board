import { describe, it, expect } from 'vitest';
import { starSignFor, formatBirthDate } from '../src/util';

describe('starSignFor', () => {
  it('returns null for a missing or unparseable birthdate', () => {
    expect(starSignFor(null)).toBeNull();
    expect(starSignFor(undefined)).toBeNull();
    expect(starSignFor('not-a-date')).toBeNull();
  });

  it('resolves a date safely inside each sign', () => {
    expect(starSignFor('2000-01-25')).toBe('Aquarius');
    expect(starSignFor('2000-02-25')).toBe('Pisces');
    expect(starSignFor('2000-03-25')).toBe('Aries');
    expect(starSignFor('2000-04-25')).toBe('Taurus');
    expect(starSignFor('2000-05-25')).toBe('Gemini');
    expect(starSignFor('2000-06-25')).toBe('Cancer');
    expect(starSignFor('2000-07-25')).toBe('Leo');
    expect(starSignFor('2000-08-25')).toBe('Virgo');
    expect(starSignFor('2000-09-25')).toBe('Libra');
    expect(starSignFor('2000-10-25')).toBe('Scorpio');
    expect(starSignFor('2000-11-25')).toBe('Sagittarius');
    expect(starSignFor('2000-12-25')).toBe('Capricorn');
  });

  it('handles the Jan 1-19 Capricorn tail before the year wraps', () => {
    expect(starSignFor('2000-01-01')).toBe('Capricorn');
    expect(starSignFor('2000-01-19')).toBe('Capricorn');
  });

  it('gets every start-of-sign cutoff exactly right', () => {
    expect(starSignFor('2000-01-20')).toBe('Aquarius');
    expect(starSignFor('2000-02-19')).toBe('Pisces');
    expect(starSignFor('2000-03-21')).toBe('Aries');
    expect(starSignFor('2000-04-20')).toBe('Taurus');
    expect(starSignFor('2000-05-21')).toBe('Gemini');
    expect(starSignFor('2000-06-21')).toBe('Cancer');
    expect(starSignFor('2000-07-23')).toBe('Leo');
    expect(starSignFor('2000-08-23')).toBe('Virgo');
    expect(starSignFor('2000-09-23')).toBe('Libra');
    expect(starSignFor('2000-10-23')).toBe('Scorpio');
    expect(starSignFor('2000-11-22')).toBe('Sagittarius');
    expect(starSignFor('2000-12-22')).toBe('Capricorn');
  });

  it('gets the day before each cutoff right (previous sign still applies)', () => {
    expect(starSignFor('2000-02-18')).toBe('Aquarius');
    expect(starSignFor('2000-12-21')).toBe('Sagittarius');
  });
});

describe('formatBirthDate', () => {
  it('returns null for a missing or unparseable birthdate', () => {
    expect(formatBirthDate(null)).toBeNull();
    expect(formatBirthDate(undefined)).toBeNull();
    expect(formatBirthDate('not-a-date')).toBeNull();
  });

  it('formats a valid ISO date as a long-form date, UTC-anchored', () => {
    expect(formatBirthDate('1999-05-14')).toBe('May 14, 1999');
  });
});
