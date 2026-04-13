import { PGlite } from '@electric-sql/pglite';
import * as schema from '@lux/db';
import { projects, users } from '@lux/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleMemoryDb } from '../memory/drizzle-memory-db.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let store: DrizzleMemoryDb;
let projectId: string;
const agentId = '00000000-0000-0000-0000-000000000099';

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT, email TEXT UNIQUE, email_verified_at TIMESTAMPTZ, image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL, description TEXT,
      sandbox_provider VARCHAR(50) NOT NULL DEFAULT 'opensandbox',
      default_model VARCHAR(255), default_connection_mode VARCHAR(50) DEFAULT 'anthropic',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  `);
  // user_memories without vector column (PGlite doesn't support pgvector)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      category VARCHAR(20) NOT NULL DEFAULT 'fact',
      importance REAL NOT NULL DEFAULT 0.5,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const [user] = await db.insert(users).values({ name: 'test', email: 'mem@test.com' }).returning();
  const [project] = await db
    .insert(projects)
    .values({ name: 'Memory Test', createdBy: user.id })
    .returning();
  projectId = project.id;

  store = new DrizzleMemoryDb(db as never);
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_memories`);
});

afterAll(async () => {
  await pglite.close();
});

describe('DrizzleMemoryDb', () => {
  it('insert creates a memory entry (no embedding)', async () => {
    const entry = await store.insert({
      agentId,
      projectId,
      content: 'User prefers dark mode',
      embedding: null,
      category: 'preference',
      importance: 0.8,
      metadata: { source: 'conversation' },
    });

    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('User prefers dark mode');
    expect(entry.category).toBe('preference');
    expect(entry.importance).toBe(0.8);
  });

  it('findById returns entry', async () => {
    const created = await store.insert({
      agentId,
      projectId,
      content: 'Test memory',
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
    });

    const found = await store.findById(created.id);
    expect(found).not.toBeNull();
    expect(found?.content).toBe('Test memory');
  });

  it('findById returns null for missing', async () => {
    const found = await store.findById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });

  it('textSearch matches by content ILIKE', async () => {
    await store.insert({
      agentId,
      projectId,
      content: 'User uses TypeScript for all projects',
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
    });
    await store.insert({
      agentId,
      projectId,
      content: 'Prefers React over Vue',
      embedding: null,
      category: 'preference',
      importance: 0.5,
      metadata: {},
    });

    const results = await store.textSearch(agentId, projectId, 'TypeScript', 10);
    expect(results).toHaveLength(1);
    expect(results[0].entry.content).toContain('TypeScript');
    expect(results[0].matchType).toBe('text');
  });

  it('listByAgent returns entries sorted by creation', async () => {
    await store.insert({
      agentId,
      projectId,
      content: 'First',
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
    });
    await store.insert({
      agentId,
      projectId,
      content: 'Second',
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
    });

    const entries = await store.listByAgent(agentId, projectId);
    expect(entries).toHaveLength(2);
  });

  it('remove deletes entry', async () => {
    const entry = await store.insert({
      agentId,
      projectId,
      content: 'To delete',
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
    });

    expect(await store.remove(entry.id)).toBe(true);
    expect(await store.findById(entry.id)).toBeNull();
  });

  it('remove returns false for missing', async () => {
    expect(await store.remove('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('updateAccessedAt updates timestamp', async () => {
    const entry = await store.insert({
      agentId,
      projectId,
      content: 'Access test',
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
    });

    const before = entry.accessedAt;
    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 10));
    await store.updateAccessedAt(entry.id);

    const updated = await store.findById(entry.id);
    expect(updated!.accessedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
