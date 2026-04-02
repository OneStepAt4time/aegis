import { describe, expect, it } from 'vitest';
import { CircularBuffer } from '../utils/circular-buffer.js';

describe('CircularBuffer', () => {
  it('stores items until capacity', () => {
    const buffer = new CircularBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    expect(buffer.toArray()).toEqual([1, 2]);
    expect(buffer.size()).toBe(2);
  });

  it('evicts oldest item when capacity is exceeded', () => {
    const buffer = new CircularBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
    expect(buffer.size()).toBe(3);
  });

  it('preserves insertion order through multiple wraparounds', () => {
    const buffer = new CircularBuffer<number>(4);
    for (let i = 1; i <= 10; i++) {
      buffer.push(i);
    }
    expect(buffer.toArray()).toEqual([7, 8, 9, 10]);
  });

  it('clear resets internal state', () => {
    const buffer = new CircularBuffer<number>(2);
    buffer.push(1);
    buffer.push(2);
    buffer.clear();
    expect(buffer.toArray()).toEqual([]);
    expect(buffer.size()).toBe(0);
    buffer.push(3);
    expect(buffer.toArray()).toEqual([3]);
  });

  it('throws on invalid capacity', () => {
    expect(() => new CircularBuffer<number>(0)).toThrow();
    expect(() => new CircularBuffer<number>(-1)).toThrow();
    expect(() => new CircularBuffer<number>(1.5)).toThrow();
  });
});
