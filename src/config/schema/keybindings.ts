import { z } from 'zod';
import { enabledByDefault, nonEmptyString } from './primitives.js';

export const KEYBINDING_COMMANDS = [
  'app.quit',
  'cursor.toggle',
  'offline.toggle',
  'companion.toggle',
  'devtools.toggle',
] as const;

export const keybindingSchema = z
  .object({
    /** Electron accelerator-style chord, e.g. `ctrl+q`, `ctrl+shift+?`. */
    key: nonEmptyString('keybindings.bindings[].key'),
    command: z.enum(KEYBINDING_COMMANDS),
  })
  .strict();

export const keybindingsSchema = z
  .object({
    enabled: enabledByDefault,
    bindings: z.array(keybindingSchema).default([
      { key: 'ctrl+q', command: 'app.quit' },
      { key: 'cmd+q', command: 'app.quit' },
      { key: 'ctrl+shift+i', command: 'devtools.toggle' },
      { key: 'cmd+shift+i', command: 'devtools.toggle' },
      { key: 'ctrl+shift+o', command: 'offline.toggle' },
      { key: 'cmd+shift+o', command: 'offline.toggle' },
      { key: 'ctrl+shift+c', command: 'cursor.toggle' },
      { key: 'cmd+shift+c', command: 'cursor.toggle' },
      { key: 'ctrl+shift+?', command: 'companion.toggle' },
      { key: 'cmd+shift+?', command: 'companion.toggle' },
    ]),
  })
  .strict();
