import { describe, expect, it } from 'vitest';
import { buildActionScript } from './script.js';
import type { SoakStep } from './types.js';

describe('buildActionScript', () => {
  it('builds valid mouse click script with correct coordinates and button', () => {
    const action: SoakStep = {
      step: 1,
      timestamp: 1000,
      type: 'click',
      windowId: 'w1',
      details: { x: 350, y: 420, button: 'right' },
    };

    const script = buildActionScript(action);
    expect(script).toContain('const x = 350;');
    expect(script).toContain('const y = 420;');
    expect(script).toContain('button: 2');
    expect(script).toContain("new MouseEvent('click', init)");
  });

  it('builds valid mouse move script with coordinates', () => {
    const action: SoakStep = {
      step: 2,
      timestamp: 2000,
      type: 'move',
      windowId: 'w1',
      details: { x: 100, y: 200 },
    };

    const script = buildActionScript(action);
    expect(script).toContain('const x = 100;');
    expect(script).toContain('const y = 200;');
    expect(script).toContain("new MouseEvent('mousemove'");
  });

  it('builds keyboard event script with properly escaped key', () => {
    const action: SoakStep = {
      step: 3,
      timestamp: 3000,
      type: 'key',
      windowId: 'w1',
      details: { key: 'Enter' },
    };

    const script = buildActionScript(action);
    expect(script).toContain('key: "Enter"');
    expect(script).toContain("new KeyboardEvent('keydown'");
    expect(script).toContain("new KeyboardEvent('keyup'");
  });

  it('builds scroll script with delta values', () => {
    const action: SoakStep = {
      step: 4,
      timestamp: 4000,
      type: 'scroll',
      windowId: 'w1',
      details: { deltaX: -30, deltaY: 75 },
    };

    const script = buildActionScript(action);
    expect(script).toContain('left: -30');
    expect(script).toContain('top: 75');
    expect(script).toContain('window.scrollBy');
  });
});
