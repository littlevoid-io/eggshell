import { shell } from 'electron';

export function isValidHttpUrl(target: string): boolean {
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function openExternalUrl(url: string): Promise<void> {
  if (!isValidHttpUrl(url)) {
    return Promise.resolve();
  }
  return shell.openExternal(url);
}
