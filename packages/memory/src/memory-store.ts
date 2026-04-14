import { applyMMR, applyTimeDecay } from './hybrid-search.js';
import type {
  CreateMemoryInput,
  MemoryEntry,
  MemorySearchOptions,
  MemorySearchResult,
} from './types.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions: number;
}

export interface MemoryDb {
  insert(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessedAt'>): Promise<MemoryEntry>;
  findById(id: string): Promise<MemoryEntry | null>;
  vectorSearch(
    agentId: string,
    projectId: string,
    embedding: number[],
    limit: number,
    minScore: number
  ): Promise<MemorySearchResult[]>;
  textSearch(
    agentId: string,
    projectId: string,
    query: string,
    limit: number
  ): Promise<MemorySearchResult[]>;
  listByAgent(agentId: string, projectId: string, limit?: number): Promise<MemoryEntry[]>;
  remove(id: string): Promise<boolean>;
  updateAccessedAt(id: string): Promise<void>;
}

export class MemoryStore {
  private vectorWeight: number;
  private textWeight: number;

  constructor(
    private db: MemoryDb,
    private embedding: EmbeddingProvider,
    options: { vectorWeight?: number; textWeight?: number } = {}
  ) {
    this.vectorWeight = options.vectorWeight ?? 0.7;
    this.textWeight = options.textWeight ?? 0.3;
  }

  async add(input: CreateMemoryInput): Promise<MemoryEntry> {
    const embeddingVector = await this.embedding.embed(input.content);
    return this.db.insert({
      agentId: input.agentId,
      projectId: input.projectId,
      content: input.content,
      embedding: embeddingVector,
      category: input.category ?? 'fact',
      importance: input.importance ?? 0.5,
      metadata: input.metadata ?? {},
    });
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.0;

    const queryEmbedding = await this.embedding.embed(options.query);

    const [vectorResults, textResults] = await Promise.all([
      this.db.vectorSearch(options.agentId, options.projectId, queryEmbedding, limit * 2, minScore),
      this.db.textSearch(options.agentId, options.projectId, options.query, limit * 2),
    ]);

    let merged = this.hybridMerge(vectorResults, textResults, limit);

    if (options.categories && options.categories.length > 0) {
      const cats = options.categories;
      merged = merged.filter((r) => cats.includes(r.entry.category));
    }

    // Optional: apply time decay
    if (options.decayHalfLifeDays !== undefined) {
      merged = applyTimeDecay(merged, options.decayHalfLifeDays);
      merged.sort((a, b) => b.score - a.score);
    }

    // Optional: apply MMR diversity re-ranking
    if (options.mmrLambda !== undefined) {
      const candidatesWithEmbedding = merged.map((r) => ({
        ...r,
        embedding: r.entry.embedding,
      }));
      merged = applyMMR(candidatesWithEmbedding, limit, options.mmrLambda);
    }

    for (const result of merged) {
      this.db.updateAccessedAt(result.entry.id).catch(() => {});
    }

    return merged;
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    return this.db.findById(id);
  }

  async listByAgent(agentId: string, projectId: string, limit?: number): Promise<MemoryEntry[]> {
    return this.db.listByAgent(agentId, projectId, limit);
  }

  async remove(id: string): Promise<void> {
    const removed = await this.db.remove(id);
    if (!removed) throw new Error('Memory entry not found');
  }

  private hybridMerge(
    vectorResults: MemorySearchResult[],
    textResults: MemorySearchResult[],
    limit: number
  ): MemorySearchResult[] {
    const scoreMap = new Map<
      string,
      { entry: MemoryEntry; vectorScore: number; textScore: number }
    >();

    for (const r of vectorResults) {
      scoreMap.set(r.entry.id, {
        entry: r.entry,
        vectorScore: r.score,
        textScore: 0,
      });
    }

    for (const r of textResults) {
      const existing = scoreMap.get(r.entry.id);
      if (existing) {
        existing.textScore = r.score;
      } else {
        scoreMap.set(r.entry.id, {
          entry: r.entry,
          vectorScore: 0,
          textScore: r.score,
        });
      }
    }

    return Array.from(scoreMap.values())
      .map((item) => ({
        entry: item.entry,
        score: item.vectorScore * this.vectorWeight + item.textScore * this.textWeight,
        matchType: (item.vectorScore > 0 && item.textScore > 0
          ? 'hybrid'
          : item.vectorScore > 0
            ? 'vector'
            : 'text') as MemorySearchResult['matchType'],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
