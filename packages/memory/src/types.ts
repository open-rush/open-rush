export interface MemoryEntry {
  id: string;
  agentId: string;
  projectId: string;
  content: string;
  embedding: number[] | null;
  category: MemoryCategory;
  importance: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  accessedAt: Date;
}

export type MemoryCategory = 'fact' | 'preference' | 'context' | 'skill' | 'decision';

export interface CreateMemoryInput {
  agentId: string;
  projectId: string;
  content: string;
  category?: MemoryCategory;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchOptions {
  agentId: string;
  projectId: string;
  query: string;
  limit?: number;
  minScore?: number;
  categories?: MemoryCategory[];
  /** Time decay half-life in days. When set, older memories score lower. */
  decayHalfLifeDays?: number;
  /** MMR lambda (0-1). When set, re-ranks for diversity. Default 0.8 = high relevance. */
  mmrLambda?: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: 'vector' | 'text' | 'hybrid';
}
