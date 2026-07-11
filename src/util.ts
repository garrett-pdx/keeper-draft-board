import type { SleeperUser } from './types';

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function displayNameFor(user: SleeperUser | undefined | null): string {
  return (
    (user && user.metadata && user.metadata.team_name) ||
    (user && user.display_name) ||
    'Unnamed Team'
  );
}

export function formatBirthDate(birthDate: string | null | undefined): string | null {
  if (!birthDate) return null;
  const d = new Date(`${birthDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Cutoffs in calendar order (month, day-of-month a sign STARTS on). A date
// before the first cutoff (Jan 1-19) falls through to Capricorn, which also
// covers the Dec 22-31 tail — the one sign that wraps the year boundary.
const ZODIAC_CUTOFFS: Array<[month: number, day: number, sign: string]> = [
  [1, 20, 'Aquarius'],
  [2, 19, 'Pisces'],
  [3, 21, 'Aries'],
  [4, 20, 'Taurus'],
  [5, 21, 'Gemini'],
  [6, 21, 'Cancer'],
  [7, 23, 'Leo'],
  [8, 23, 'Virgo'],
  [9, 23, 'Libra'],
  [10, 23, 'Scorpio'],
  [11, 22, 'Sagittarius'],
  [12, 22, 'Capricorn'],
];

export function starSignFor(birthDate: string | null | undefined): string | null {
  if (!birthDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  let sign = 'Capricorn';
  for (const [m, d, name] of ZODIAC_CUTOFFS) {
    if (month > m || (month === m && day >= d)) sign = name;
  }
  return sign;
}
