/**
 * 增强搜索纯函数
 *
 * 时间衰减（Time Decay）和最大边际相关性（MMR）去重。
 * 可选地增强 MemoryStore.search() 的结果。
 */

import type { MemoryEntry, MemorySearchResult } from './types.js';

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

/** Compute cosine similarity between two vectors. Returns 0 for zero vectors. */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Time decay
// ---------------------------------------------------------------------------

/**
 * Apply exponential time decay to search results.
 *
 * score *= 2^(-daysSinceUpdate / halfLifeDays)
 *
 * Entries marked as "evergreen" (via the optional predicate) are exempt.
 */
export function applyTimeDecay(
  results: MemorySearchResult[],
  halfLifeDays: number,
  options?: { isEvergreen?: (entry: MemoryEntry) => boolean }
): MemorySearchResult[] {
  const now = Date.now();
  const isEvergreen = options?.isEvergreen;

  return results.map((r) => {
    if (isEvergreen?.(r.entry)) return r;
    const ageMs = now - r.entry.accessedAt.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const decayFactor = 2 ** (-ageDays / halfLifeDays);
    return { ...r, score: r.score * decayFactor };
  });
}

// ---------------------------------------------------------------------------
// MMR (Maximal Marginal Relevance)
// ---------------------------------------------------------------------------

type CandidateWithEmbedding = MemorySearchResult & { embedding?: number[] | null };

/**
 * Re-rank results using Maximal Marginal Relevance.
 *
 * Balances relevance (score) with diversity (1 - maxSimilarity to already selected).
 * lambda = 1.0 means pure relevance, 0.0 means pure diversity.
 */
export function applyMMR(
  candidates: CandidateWithEmbedding[],
  limit: number,
  lambda = 0.8
): MemorySearchResult[] {
  if (candidates.length <= limit) {
    return candidates.map(({ embedding: _e, ...rest }) => rest);
  }

  const selected: CandidateWithEmbedding[] = [];
  const remaining = [...candidates];

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate.score;

      let maxSim = 0;
      if (candidate.embedding && candidate.embedding.length > 0) {
        for (const sel of selected) {
          if (sel.embedding && sel.embedding.length > 0) {
            const sim = cosineSim(candidate.embedding, sel.embedding);
            if (sim > maxSim) maxSim = sim;
          }
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestMmr) {
        bestMmr = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    } else {
      break;
    }
  }

  return selected.map(({ embedding: _e, ...rest }) => rest);
}
