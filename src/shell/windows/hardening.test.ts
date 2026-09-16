import { describe, expect, it } from 'vitest';
import type { Input } from 'electron';
import { isKioskEscape } from './hardening.js';

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

describe('isKioskEscape', () => {
  it('blocks devtools chords and kiosk escape keys', () => {
    expect(isKioskEscape(keyDown('F12'))).toBe(true);
    expect(isKioskEscape(keyDown('I', { control: true, shift: true }))).toBe(true);
    expect(isKioskEscape(keyDown('Escape'))).toBe(true);
    expect(isKioskEscape(keyDown('F11'))).toBe(true);
  });

  it('lets ordinary input through', () => {
    expect(isKioskEscape(keyDown('a'))).toBe(false);
    expect(isKioskEscape(keyDown('i', { control: true }))).toBe(false);
    expect(isKioskEscape({ ...keyDown('Escape'), type: 'keyUp' })).toBe(false);
  });
});
