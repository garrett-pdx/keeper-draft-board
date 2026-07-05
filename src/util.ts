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
