import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Input } from 'electron';
import { handleInput, matchKeybinding } from './keybindings.js';

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

  it('matches ctrl+shift+i and cmd+shift+i for devtools toggle', () => {
    expect(
      matchKeybinding(keyDown('i', { control: true, shift: true }), {
        key: 'ctrl+shift+i',
        command: 'devtools.toggle',
      })
    ).toBe(true);
    expect(
      matchKeybinding(keyDown('I', { meta: true, shift: true }), {
        key: 'cmd+shift+i',
        command: 'devtools.toggle',
      })
    ).toBe(true);
    expect(
      matchKeybinding(keyDown('i', { control: true }), {
        key: 'ctrl+shift+i',
        command: 'devtools.toggle',
      })
    ).toBe(false);
  });

  it('matches ctrl+shift+? for companion toggle', () => {
    expect(
      matchKeybinding(keyDown('?', { control: true, shift: true }), {
        key: 'ctrl+shift+?',
        command: 'companion.toggle',
      })
    ).toBe(true);
  });

  it('ignores key up', () => {
    const input = { ...keyDown('q', { control: true }), type: 'keyUp' as const };
    expect(matchKeybinding(input, { key: 'ctrl+q', command: 'app.quit' })).toBe(false);
  });
});

describe('handleInput', () => {
  it('invokes matching command handler with target window', () => {
    const fakeWindow = {} as BrowserWindow;
    const handlers = {
      'app.quit': vi.fn(),
      'cursor.toggle': vi.fn(),
      'offline.toggle': vi.fn(),
      'companion.toggle': vi.fn(),
      'devtools.toggle': vi.fn(),
    };
    const input = keyDown('i', { control: true, shift: true });
    const match = handleInput(
      fakeWindow,
      input,
      [{ key: 'ctrl+shift+i', command: 'devtools.toggle' }],
      handlers
    );
    expect(match?.command).toBe('devtools.toggle');
    expect(handlers['devtools.toggle']).toHaveBeenCalledWith(fakeWindow);
  });
});
