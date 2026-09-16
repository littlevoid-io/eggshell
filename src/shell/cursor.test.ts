import { describe, expect, it } from 'vitest';
import { initialCursorVisible } from './cursor.js';

describe('initialCursorVisible', () => {
  it('hides the cursor in auto mode when any window is kiosk', () => {
    expect(initialCursorVisible({ visible: 'auto' }, [{ kiosk: false }, { kiosk: true }])).toBe(
      false
    );
    expect(initialCursorVisible({ visible: 'auto' }, [{ kiosk: false }])).toBe(true);
  });

  it('honours an explicit setting regardless of kiosk mode', () => {
    expect(initialCursorVisible({ visible: true }, [{ kiosk: true }])).toBe(true);
    expect(initialCursorVisible({ visible: false }, [{ kiosk: false }])).toBe(false);
  });
});
