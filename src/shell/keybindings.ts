import type { BrowserWindow, Input } from 'electron';
import type { Keybinding, Keybindings } from '../config/types.js';
import type { KEYBINDING_COMMANDS } from '../config/schema/features.js';
import type { Logger } from '../logging/logger.js';

export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number];
export type CommandHandler = (window: BrowserWindow) => void;
export type CommandHandlers = Record<KeybindingCommand, CommandHandler>;

const MODIFIER_ALIASES: Record<string, keyof Pick<Input, 'shift' | 'control' | 'alt' | 'meta'>> = {
  shift: 'shift',
  ctrl: 'control',
  control: 'control',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

/** `ctrl+shift+q` style chords against an Electron `before-input-event` input. */
export function matchKeybinding(input: Input, binding: Keybinding): boolean {
  if (input.type !== 'keyDown') return false;
  const parts = binding.key.toLowerCase().split('+');
  const key = parts.at(-1);
  const wanted = new Set(parts.slice(0, -1).map(part => MODIFIER_ALIASES[part]));
  const modifiers = ['shift', 'control', 'alt', 'meta'] as const;
  return (
    input.key.toLowerCase() === key && modifiers.every(name => input[name] === wanted.has(name))
  );
}

export function handleInput(
  window: BrowserWindow,
  input: Input,
  bindings: readonly Keybinding[],
  handlers: CommandHandlers
): Keybinding | undefined {
  const match = bindings.find(binding => matchKeybinding(input, binding));
  if (match) handlers[match.command](window);
  return match;
}

/** Wires configured chords on a window. Matched input never reaches the page. */
export function attachKeybindings(
  window: BrowserWindow,
  config: Keybindings,
  handlers: CommandHandlers,
  logger: Logger
): void {
  if (!config.enabled) return;
  window.webContents.on('before-input-event', (event, input) => {
    const match = handleInput(window, input, config.bindings, handlers);
    if (!match) return;
    event.preventDefault();
    logger.info('keybinding', { key: match.key, command: match.command });
  });
}
