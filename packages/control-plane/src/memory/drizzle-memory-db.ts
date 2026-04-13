import { type DbClient, userMemories } from '@lux/db';
import type { MemoryDb } from '@lux/memory';
import type { MemoryEntry, MemorySearchResult } from '@lux/memory';
import { and, desc, eq, sql } from 'drizzle-orm';

type MemoryRow = typeof userMemories.$inferSelect;

function mapRow(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    content: row.content,
    embedding: null, // embeddings stored separately via raw SQL
    category: row.category as MemoryEntry['category'],
    importance: row.importance,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    accessedAt: row.accessedAt,
  };
}

export class DrizzleMemoryDb implements MemoryDb {
  constructor(private db: DbClient) {}

  async insert(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessedAt'>,
  ): Promise<MemoryEntry> {
    if (entry.embedding && entry.embedding.length > 0) {
      // Use raw SQL to insert with pgvector embedding
      const vectorStr = `[${entry.embedding.join(',')}]`;
      const rows = await this.db.execute(sql`
        INSERT INTO user_memories (agent_id, project_id, content, category, importance, metadata, embedding)
        VALUES (${entry.agentId}, ${entry.projectId}, ${entry.content}, ${entry.category},
                ${entry.importance}, ${JSON.stringify(entry.metadata)}::jsonb, ${vectorStr}::vector)
        RETURNING id, agent_id, project_id, content, category, importance, metadata, created_at, accessed_at
      `);
      const row = (rows as unknown as Record<string, unknown>[])[0] as Record<string, unknown>;
      return {
        id: row.id as string,
        agentId: row.agent_id as string,
        projectId: row.project_id as string,
        content: row.content as string,
        embedding: entry.embedding,
        category: row.category as MemoryEntry['category'],
        importance: row.importance as number,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: new Date(row.created_at as string),
        accessedAt: new Date(row.accessed_at as string),
      };
    }

    // No embedding — use Drizzle ORM
    const [row] = await this.db
      .insert(userMemories)
      .values({
        agentId: entry.agentId,
        projectId: entry.projectId,
        content: entry.content,
        category: entry.category,
        importance: entry.importance,
        metadata: entry.metadata,
      })
      .returning();
    return mapRow(row);
  }

  async findById(id: string): Promise<MemoryEntry | null> {
    const [row] = await this.db
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async vectorSearch(
    agentId: string,
    projectId: string,
    embedding: number[],
    limit: number,
    minScore: number,
  ): Promise<MemorySearchResult[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const rows = await this.db.execute(sql`
      SELECT id, agent_id, project_id, content, category, importance, metadata,
             created_at, accessed_at,
             1 - (embedding <=> ${vectorStr}::vector) AS score
      FROM user_memories
      WHERE agent_id = ${agentId}
        AND project_id = ${projectId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorStr}::vector) >= ${minScore}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (rows as unknown as Record<string, unknown>[]).map((row) => ({
      entry: {
        id: row.id as string,
        agentId: row.agent_id as string,
        projectId: row.project_id as string,
        content: row.content as string,
        embedding: null,
        category: row.category as MemoryEntry['category'],
        importance: row.importance as number,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: new Date(row.created_at as string),
        accessedAt: new Date(row.accessed_at as string),
      },
      score: row.score as number,
      matchType: 'vector' as const,
    }));
  }

  async textSearch(
    agentId: string,
    projectId: string,
    query: string,
    limit: number,
  ): Promise<MemorySearchResult[]> {
    // Simple ILIKE text search; upgrade to ts_vector for production
    const rows = await this.db
      .select()
      .from(userMemories)
      .where(
        and(
          eq(userMemories.agentId, agentId),
          eq(userMemories.projectId, projectId),
          sql`${userMemories.content} ILIKE ${'%' + query + '%'}`,
        ),
      )
      .orderBy(desc(userMemories.createdAt))
      .limit(limit);

    return rows.map((row, i) => ({
      entry: mapRow(row),
      score: 1 - i * 0.05, // simple rank decay
      matchType: 'text' as const,
    }));
  }

  async listByAgent(
    agentId: string,
    projectId: string,
    limit = 50,
  ): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(userMemories)
      .where(and(eq(userMemories.agentId, agentId), eq(userMemories.projectId, projectId)))
      .orderBy(desc(userMemories.createdAt))
      .limit(limit);
    return rows.map(mapRow);
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(userMemories)
      .where(eq(userMemories.id, id))
      .returning();
    return rows.length > 0;
  }

  async updateAccessedAt(id: string): Promise<void> {
    await this.db
      .update(userMemories)
      .set({ accessedAt: new Date() })
      .where(eq(userMemories.id, id));
  }
}
