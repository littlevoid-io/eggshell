import { describe, expect, it } from 'vitest';
import { createLineSplitter, createLineStream } from './line-stream.js';
import type { ProcessLine } from './types.js';

describe('createLineSplitter', () => {
  it('splits chunks on newlines and strips carriage returns', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter(text => lines.push(text));

    splitter.push('hello\r\nworld\n');
    expect(lines).toEqual(['hello', 'world']);
  });

  it('buffers trailing content until flush', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter(text => lines.push(text));

    splitter.push('part1');
    expect(lines).toEqual([]);
    splitter.push('part2\npart3');
    expect(lines).toEqual(['part1part2']);
    splitter.flush();
    expect(lines).toEqual(['part1part2', 'part3']);
  });

  it('flush on empty buffer is a no-op', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter(text => lines.push(text));

    splitter.flush();
    expect(lines).toEqual([]);
  });
});

describe('createLineStream', () => {
  it('delivers live lines to subscribers', () => {
    const stream = createLineStream();
    const collected: ProcessLine[] = [];
    const unsubscribe = stream.stream.onLine(line => collected.push(line));

    stream.emit({ stream: 'stdout', text: 'first' });
    stream.emit({ stream: 'stderr', text: 'second' });
    unsubscribe();
    stream.emit({ stream: 'stdout', text: 'third' });

    expect(collected).toEqual([
      { stream: 'stdout', text: 'first' },
      { stream: 'stderr', text: 'second' },
    ]);
  });

  it('replays buffered lines to late subscribers up to replay limit', () => {
    const stream = createLineStream();
    for (let i = 0; i < 210; i++) {
      stream.emit({ stream: 'stdout', text: `line-${i}` });
    }

    const replayed: ProcessLine[] = [];
    stream.stream.onLine(line => replayed.push(line));

    expect(replayed).toHaveLength(200);
    expect(replayed[0]).toEqual({ stream: 'stdout', text: 'line-10' });
    expect(replayed[199]).toEqual({ stream: 'stdout', text: 'line-209' });
  });
});
