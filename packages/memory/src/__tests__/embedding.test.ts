import { describe, expect, it } from 'vitest';
import { NullEmbeddingProvider, withTimeout } from '../embedding.js';

describe('withTimeout', () => {
  it('resolves with value when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('returns null when timeout fires first', async () => {
    const slowPromise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(42), 5000);
    });
    const result = await withTimeout(slowPromise, 10);
    expect(result).toBeNull();
  });

  it('returns null when promise rejects', async () => {
    const result = await withTimeout(Promise.reject(new Error('fail')), 1000);
    expect(result).toBeNull();
  });
});

describe('NullEmbeddingProvider', () => {
  it('has dimensions = 0', () => {
    const provider = new NullEmbeddingProvider();
    expect(provider.dimensions).toBe(0);
  });

  it('returns empty array from embed', async () => {
    const provider = new NullEmbeddingProvider();
    const result = await provider.embed('hello world');
    expect(result).toEqual([]);
  });
});
