import { describe, expect, it } from 'vitest';
import { generateRandomSeed, Mulberry32Generator } from './prng.js';

describe('Mulberry32Generator (T4.4)', () => {
  it('produces identical output sequence for identical seeds', () => {
    const generatorA = new Mulberry32Generator(42);
    const generatorB = new Mulberry32Generator(42);

    const sequenceA = Array.from({ length: 20 }, () => generatorA.next());
    const sequenceB = Array.from({ length: 20 }, () => generatorB.next());

    expect(sequenceA).toEqual(sequenceB);
  });

  it('diverges when initialized with different seeds', () => {
    const generatorA = new Mulberry32Generator(42);
    const generatorB = new Mulberry32Generator(9999);

    const sequenceA = Array.from({ length: 10 }, () => generatorA.next());
    const sequenceB = Array.from({ length: 10 }, () => generatorB.next());

    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('generates integers within specified inclusive range', () => {
    const generator = new Mulberry32Generator(12345);
    const min = 10;
    const max = 25;

    for (let i = 0; i < 100; i++) {
      const val = generator.nextInt(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('picks random items from an array and throws on empty array', () => {
    const generator = new Mulberry32Generator(777);
    const items = ['alpha', 'bravo', 'charlie'];

    const chosen = Array.from({ length: 10 }, () => generator.pick(items));
    for (const item of chosen) {
      expect(items).toContain(item);
    }

    expect(() => generator.pick([])).toThrow(RangeError);
  });

  it('generates non-negative integer seed from generateRandomSeed', () => {
    const seed = generateRandomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });
});
