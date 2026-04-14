import { describe, expect, it } from 'vitest';
import { applyMMR, applyTimeDecay, cosineSim } from '../hybrid-search.js';
import type { MemoryEntry, MemorySearchResult } from '../types.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem-1',
    agentId: 'agent-1',
    projectId: 'proj-1',
    content: 'test',
    embedding: null,
    category: 'fact',
    importance: 0.5,
    metadata: {},
    createdAt: new Date(),
    accessedAt: new Date(),
    ...overrides,
  };
}

function makeResult(score: number, overrides: Partial<MemoryEntry> = {}): MemorySearchResult {
  return { entry: makeEntry(overrides), score, matchType: 'hybrid' };
}

// ---------------------------------------------------------------------------
// cosineSim
// ---------------------------------------------------------------------------

describe('cosineSim', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSim([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSim([1, 2], [1, 2, 3])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyTimeDecay
// ---------------------------------------------------------------------------

describe('applyTimeDecay', () => {
  it('halves score after one half-life', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = applyTimeDecay([makeResult(1.0, { accessedAt: thirtyDaysAgo })], 30);
    expect(result[0].score).toBeCloseTo(0.5, 1);
  });

  it('preserves score for recent entries', () => {
    const result = applyTimeDecay([makeResult(1.0, { accessedAt: new Date() })], 30);
    expect(result[0].score).toBeCloseTo(1.0, 1);
  });

  it('exempts evergreen entries', () => {
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = applyTimeDecay([makeResult(1.0, { accessedAt: oldDate })], 30, {
      isEvergreen: () => true,
    });
    expect(result[0].score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// applyMMR
// ---------------------------------------------------------------------------

describe('applyMMR', () => {
  it('deduplicates similar entries (keeps only one)', () => {
    // Two entries with near-identical embeddings
    const vec = [1, 0, 0];
    const candidates = [
      { ...makeResult(0.9, { id: 'a' }), embedding: vec },
      { ...makeResult(0.85, { id: 'b' }), embedding: vec },
    ];
    const result = applyMMR(candidates, 1, 0.8);
    expect(result).toHaveLength(1);
    expect(result[0].entry.id).toBe('a'); // highest score
  });

  it('keeps diverse entries', () => {
    const candidates = [
      { ...makeResult(0.9, { id: 'a' }), embedding: [1, 0, 0] },
      { ...makeResult(0.85, { id: 'b' }), embedding: [0, 1, 0] },
    ];
    const result = applyMMR(candidates, 2, 0.8);
    expect(result).toHaveLength(2);
  });

  it('returns all when candidates <= limit', () => {
    const candidates = [{ ...makeResult(0.9, { id: 'a' }), embedding: [1, 0] }];
    const result = applyMMR(candidates, 5, 0.8);
    expect(result).toHaveLength(1);
  });

  it('strips embedding from output', () => {
    const candidates = [{ ...makeResult(0.9, { id: 'a' }), embedding: [1, 0] }];
    const result = applyMMR(candidates, 1, 0.8);
    expect('embedding' in result[0]).toBe(false);
  });
});
