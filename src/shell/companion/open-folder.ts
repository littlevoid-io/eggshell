import { shell } from 'electron';

export function openFolder(directory: string): Promise<string> {
  return shell.openPath(directory);
}
