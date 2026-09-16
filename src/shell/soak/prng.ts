export class Mulberry32Generator {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Cannot pick from an empty array');
    }
    const index = Math.floor(this.next() * items.length);
    const item = items[index];
    if (item === undefined) {
      throw new RangeError('Cannot pick from empty array');
    }
    return item;
  }
}

export function generateRandomSeed(): number {
  const timestamp = Date.now();
  const high = (timestamp / 1000) >>> 0;
  const low = (timestamp % 1000) >>> 0;
  return (high * 1664525 + low + 1013904223) >>> 0;
}
