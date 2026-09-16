import { describe, expect, it } from 'vitest';
import type { Input } from 'electron';
import { matchKeybinding } from './keybindings.js';

function keyDown(key: string, modifiers: Partial<Input> = {}): Input {
  return {
    type: 'keyDown',
    key,
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...modifiers,
  };
}

describe('matchKeybinding', () => {
  it('matches a modifier chord exactly', () => {
    expect(
      matchKeybinding(keyDown('q', { control: true }), { key: 'ctrl+q', command: 'app.quit' })
    ).toBe(true);
    expect(matchKeybinding(keyDown('q'), { key: 'ctrl+q', command: 'app.quit' })).toBe(false);
    expect(
      matchKeybinding(keyDown('q', { control: true, shift: true }), {
        key: 'ctrl+q',
        command: 'app.quit',
      })
    ).toBe(false);
  });

  it('treats cmd as meta and is case-insensitive', () => {
    expect(
      matchKeybinding(keyDown('Q', { meta: true }), { key: 'Cmd+Q', command: 'app.quit' })
    ).toBe(true);
  });

  it('matches shift+? by the produced key', () => {
    expect(
      matchKeybinding(keyDown('?', { shift: true }), {
        key: 'shift+?',
        command: 'companion.toggle',
      })
    ).toBe(true);
  });

  it('ignores key up', () => {
    const input = { ...keyDown('q', { control: true }), type: 'keyUp' as const };
    expect(matchKeybinding(input, { key: 'ctrl+q', command: 'app.quit' })).toBe(false);
  });
});
