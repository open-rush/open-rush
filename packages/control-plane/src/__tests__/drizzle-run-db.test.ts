import { PGlite } from '@electric-sql/pglite';
import * as schema from '@rush/db';
import { agents, projects, runs, users } from '@rush/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleRunDb } from '../run/drizzle-run-db.js';

// ---------------------------------------------------------------------------
// PGlite setup (in-process PostgreSQL)
// ---------------------------------------------------------------------------

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;

// We need an agent to satisfy the FK constraint on runs.agent_id
let testAgentId: string;

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });

  // Minimal schema: just users, projects, agents, and runs tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      email TEXT UNIQUE,
      email_verified_at TIMESTAMPTZ,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      sandbox_provider VARCHAR(50) NOT NULL DEFAULT 'opensandbox',
      default_model VARCHAR(255),
      default_connection_mode VARCHAR(50) DEFAULT 'anthropic',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      name VARCHAR(120) NOT NULL DEFAULT 'New Agent',
      description TEXT,
      icon VARCHAR(50),
      provider_type VARCHAR(50) NOT NULL DEFAULT 'claude-code',
      model VARCHAR(255),
      system_prompt TEXT,
      allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      skills JSONB NOT NULL DEFAULT '[]'::jsonb,
      mcp_servers JSONB NOT NULL DEFAULT '[]'::jsonb,
      max_steps INTEGER NOT NULL DEFAULT 30,
      delivery_mode VARCHAR(20) NOT NULL DEFAULT 'chat',
      is_builtin BOOLEAN NOT NULL DEFAULT false,
      custom_title VARCHAR(200),
      config JSONB,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      active_stream_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      parent_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'queued',
      prompt TEXT NOT NULL,
      provider VARCHAR(50) NOT NULL DEFAULT 'claude-code',
      connection_mode VARCHAR(50) NOT NULL DEFAULT 'anthropic',
      model_id VARCHAR(255),
      trigger_source VARCHAR(20) NOT NULL DEFAULT 'user',
      active_stream_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      attachments_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);

  // Seed a user, project, and agent for FK constraints using Drizzle API
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email: 'test@example.com' })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({ name: 'Test Project', createdBy: user.id })
    .returning();

  const [agent] = await db.insert(agents).values({ projectId: project.id }).returning();

  testAgentId = agent.id;
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await db.delete(runs);
});

function getRunDb(): DrizzleRunDb {
  // PGlite drizzle instance is type-compatible with postgres drizzle for queries
  return new DrizzleRunDb(db as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrizzleRunDb', () => {
  describe('create', () => {
    it('creates a run with defaults', async () => {
      const rdb = getRunDb();
      const run = await rdb.create({
        agentId: testAgentId,
        prompt: 'Hello world',
      });

      expect(run.id).toBeTruthy();
      expect(run.agentId).toBe(testAgentId);
      expect(run.prompt).toBe('Hello world');
      expect(run.status).toBe('queued');
      expect(run.provider).toBe('claude-code');
      expect(run.connectionMode).toBe('anthropic');
      expect(run.triggerSource).toBe('user');
      expect(run.parentRunId).toBeNull();
      expect(run.modelId).toBeNull();
      expect(run.retryCount).toBe(0);
      expect(run.maxRetries).toBe(3);
      expect(run.errorMessage).toBeNull();
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);
      expect(run.startedAt).toBeNull();
      expect(run.completedAt).toBeNull();
    });

    it('creates a run with overrides', async () => {
      const rdb = getRunDb();
      const run = await rdb.create({
        agentId: testAgentId,
        prompt: 'Custom run',
        provider: 'bedrock',
        connectionMode: 'bedrock',
        modelId: 'claude-3-opus',
        triggerSource: 'api',
      });

      expect(run.provider).toBe('bedrock');
      expect(run.connectionMode).toBe('bedrock');
      expect(run.modelId).toBe('claude-3-opus');
      expect(run.triggerSource).toBe('api');
    });
  });

  describe('findById', () => {
    it('finds an existing run', async () => {
      const rdb = getRunDb();
      const created = await rdb.create({ agentId: testAgentId, prompt: 'find me' });

      const found = await rdb.findById(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.prompt).toBe('find me');
    });

    it('returns null for non-existent run', async () => {
      const rdb = getRunDb();
      const found = await rdb.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates status and updatedAt', async () => {
      const rdb = getRunDb();
      const created = await rdb.create({ agentId: testAgentId, prompt: 'update me' });

      const updated = await rdb.updateStatus(created.id, 'running');
      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('running');
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it('updates extra fields', async () => {
      const rdb = getRunDb();
      const created = await rdb.create({ agentId: testAgentId, prompt: 'extras' });
      const now = new Date();

      const updated = await rdb.updateStatus(created.id, 'failed', {
        errorMessage: 'Something broke',
        startedAt: now,
        completedAt: now,
        retryCount: 2,
        activeStreamId: 'stream-123',
      });

      expect(updated?.errorMessage).toBe('Something broke');
      expect(updated?.startedAt).toBeInstanceOf(Date);
      expect(updated?.completedAt).toBeInstanceOf(Date);
      expect(updated?.retryCount).toBe(2);
      expect(updated?.activeStreamId).toBe('stream-123');
    });

    it('clears errorMessage when set to null', async () => {
      const rdb = getRunDb();
      const created = await rdb.create({ agentId: testAgentId, prompt: 'clear error' });
      await rdb.updateStatus(created.id, 'failed', { errorMessage: 'Error!' });
      const cleared = await rdb.updateStatus(created.id, 'queued', { errorMessage: null });
      expect(cleared?.errorMessage).toBeNull();
    });

    it('returns null for non-existent run', async () => {
      const rdb = getRunDb();
      const result = await rdb.updateStatus('00000000-0000-0000-0000-000000000000', 'failed');
      expect(result).toBeNull();
    });
  });

  describe('listByAgent', () => {
    it('lists runs for a given agent and returns correct count', async () => {
      const rdb = getRunDb();
      const run1 = await rdb.create({ agentId: testAgentId, prompt: 'first' });
      const run2 = await rdb.create({ agentId: testAgentId, prompt: 'second' });
      const run3 = await rdb.create({ agentId: testAgentId, prompt: 'third' });

      const list = await rdb.listByAgent(testAgentId);
      expect(list).toHaveLength(3);
      const ids = list.map((r) => r.id);
      expect(ids).toContain(run1.id);
      expect(ids).toContain(run2.id);
      expect(ids).toContain(run3.id);
    });

    it('respects limit', async () => {
      const rdb = getRunDb();
      await rdb.create({ agentId: testAgentId, prompt: 'a' });
      await rdb.create({ agentId: testAgentId, prompt: 'b' });
      await rdb.create({ agentId: testAgentId, prompt: 'c' });

      const list = await rdb.listByAgent(testAgentId, 2);
      expect(list).toHaveLength(2);
    });

    it('returns empty for unknown agent', async () => {
      const rdb = getRunDb();
      const list = await rdb.listByAgent('00000000-0000-0000-0000-000000000000');
      expect(list).toHaveLength(0);
    });
  });

  describe('findStuckRuns', () => {
    it('finds non-terminal runs with old updatedAt', async () => {
      const rdb = getRunDb();
      const run = await rdb.create({ agentId: testAgentId, prompt: 'stuck' });

      // Manually set updatedAt to 5 minutes ago
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      await db
        .update(runs)
        .set({ updatedAt: fiveMinAgo, status: 'running' })
        .where(eq(runs.id, run.id));

      const stuck = await rdb.findStuckRuns(2 * 60 * 1000); // 2 min threshold
      expect(stuck).toHaveLength(1);
      expect(stuck[0].id).toBe(run.id);
      expect(stuck[0].status).toBe('running');
    });

    it('excludes completed runs', async () => {
      const rdb = getRunDb();
      const run = await rdb.create({ agentId: testAgentId, prompt: 'done' });

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      await db
        .update(runs)
        .set({ updatedAt: fiveMinAgo, status: 'completed' })
        .where(eq(runs.id, run.id));

      const stuck = await rdb.findStuckRuns(2 * 60 * 1000);
      expect(stuck).toHaveLength(0);
    });

    it('excludes failed runs', async () => {
      const rdb = getRunDb();
      const run = await rdb.create({ agentId: testAgentId, prompt: 'failed' });

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      await db
        .update(runs)
        .set({ updatedAt: fiveMinAgo, status: 'failed' })
        .where(eq(runs.id, run.id));

      const stuck = await rdb.findStuckRuns(2 * 60 * 1000);
      expect(stuck).toHaveLength(0);
    });

    it('excludes recently updated non-terminal runs', async () => {
      const rdb = getRunDb();
      await rdb.create({ agentId: testAgentId, prompt: 'fresh' });
      // updatedAt is now(), which is within the 2 min threshold

      const stuck = await rdb.findStuckRuns(2 * 60 * 1000);
      expect(stuck).toHaveLength(0);
    });

    it('finds worker_unreachable stuck runs', async () => {
      const rdb = getRunDb();
      const run = await rdb.create({ agentId: testAgentId, prompt: 'unreachable' });

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      await db
        .update(runs)
        .set({ updatedAt: fiveMinAgo, status: 'worker_unreachable' })
        .where(eq(runs.id, run.id));

      const stuck = await rdb.findStuckRuns(2 * 60 * 1000);
      expect(stuck).toHaveLength(1);
      expect(stuck[0].status).toBe('worker_unreachable');
    });
  });
});
