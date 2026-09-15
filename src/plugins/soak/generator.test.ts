import { describe, expect, it } from 'vitest';
import { ActionGenerator } from './generator.js';
import { Mulberry32Generator } from './prng.js';
import type { ClickDetails, MoveDetails } from './types.js';

describe('ActionGenerator (T4.4)', () => {
  it('produces identical action sequence for identical seeds', () => {
    const generatorA = new ActionGenerator({ random: new Mulberry32Generator(100) });
    const generatorB = new ActionGenerator({ random: new Mulberry32Generator(100) });

    const actionsA = Array.from({ length: 15 }, (_, i) => generatorA.nextAction('win-1', 1000 + i));
    const actionsB = Array.from({ length: 15 }, (_, i) => generatorB.nextAction('win-1', 1000 + i));

    expect(actionsA).toEqual(actionsB);
  });

  it('diverges when initialized with different seeds', () => {
    const generatorA = new ActionGenerator({ random: new Mulberry32Generator(100) });
    const generatorB = new ActionGenerator({ random: new Mulberry32Generator(200) });

    const actionsA = Array.from({ length: 10 }, (_, i) => generatorA.nextAction('win-1', 1000 + i));
    const actionsB = Array.from({ length: 10 }, (_, i) => generatorB.nextAction('win-1', 1000 + i));

    expect(actionsA).not.toEqual(actionsB);
  });

  it('respects actionTypes filter to generate only specified types', () => {
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(42),
      actionTypes: ['click'],
    });

    const actions = Array.from({ length: 20 }, (_, i) => generator.nextAction('win-1', 2000 + i));
    for (const action of actions) {
      expect(action.type).toBe('click');
      expect((action.details as ClickDetails).button).toMatch(/left|right/);
    }
  });

  it('increments step counter and records windowId and timestamp', () => {
    const generator = new ActionGenerator({ random: new Mulberry32Generator(55) });

    const a1 = generator.nextAction('test-win', 5000);
    const a2 = generator.nextAction('test-win', 6000);

    expect(a1.step).toBe(1);
    expect(a1.windowId).toBe('test-win');
    expect(a1.timestamp).toBe(5000);

    expect(a2.step).toBe(2);
    expect(a2.windowId).toBe('test-win');
    expect(a2.timestamp).toBe(6000);
    expect(generator.getStepCount()).toBe(2);
  });

  it('constrains coordinate generation to configured viewport', () => {
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(88),
      actionTypes: ['move'],
      viewportWidth: 800,
      viewportHeight: 600,
    });

    for (let i = 0; i < 50; i++) {
      const action = generator.nextAction('win-1', 1000 + i);
      const details = action.details as MoveDetails;
      expect(details.x).toBeGreaterThanOrEqual(0);
      expect(details.x).toBeLessThanOrEqual(800);
      expect(details.y).toBeGreaterThanOrEqual(0);
      expect(details.y).toBeLessThanOrEqual(600);
    }
  });

  it('constrains coordinate generation to per-call viewport bounds', () => {
    const generator = new ActionGenerator({
      random: new Mulberry32Generator(99),
      actionTypes: ['click', 'move'],
    });

    for (let i = 0; i < 50; i++) {
      const action = generator.nextAction('win-1', 1000 + i, 800, 600);
      const details = action.details as ClickDetails | MoveDetails;
      expect(details.x).toBeGreaterThanOrEqual(0);
      expect(details.x).toBeLessThanOrEqual(800);
      expect(details.y).toBeGreaterThanOrEqual(0);
      expect(details.y).toBeLessThanOrEqual(600);
    }
  });

  it('produces identical action sequence for identical seeds with per-call viewport', () => {
    const generatorA = new ActionGenerator({ random: new Mulberry32Generator(100) });
    const generatorB = new ActionGenerator({ random: new Mulberry32Generator(100) });

    const actionsA = Array.from({ length: 15 }, (_, i) =>
      generatorA.nextAction('win-1', 1000 + i, 800, 600)
    );
    const actionsB = Array.from({ length: 15 }, (_, i) =>
      generatorB.nextAction('win-1', 1000 + i, 800, 600)
    );

    expect(actionsA).toEqual(actionsB);
  });
});
