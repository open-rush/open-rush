import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { agents, projects, runEvents, runs, users } from '@open-rush/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleEventStore } from '../drizzle-event-store.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let runId: string;

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });

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
      append_system_prompt TEXT,
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
      current_version INTEGER NOT NULL DEFAULT 1,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      task_id UUID,
      conversation_id UUID,
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
      agent_definition_version INTEGER,
      idempotency_key VARCHAR(255),
      idempotency_request_hash VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS run_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB,
      seq BIGINT NOT NULL,
      schema_version VARCHAR(10) NOT NULL DEFAULT '1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT run_events_run_seq_idx UNIQUE(run_id, seq)
    )
  `);

  const [user] = await db
    .insert(users)
    .values({ name: 'Test', email: 'event@test.dev' })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ name: 'Project', createdBy: user.id })
    .returning();
  const [agent] = await db.insert(agents).values({ projectId: project.id }).returning();
  const [run] = await db.insert(runs).values({ agentId: agent.id, prompt: 'Hello' }).returning();
  runId = run.id;
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await db.delete(runEvents);
});

describe('DrizzleEventStore', () => {
  it('appends and reads events from the database', async () => {
    const store = new DrizzleEventStore(db as never);
    await store.append({
      runId,
      eventType: 'text-delta',
      payload: { type: 'text-delta', content: 'Hello' },
      seq: 0,
    });
    await store.append({
      runId,
      eventType: 'text-delta',
      payload: { type: 'text-delta', content: ' world' },
      seq: 1,
    });

    const events = await store.getEvents(runId);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(0);
    expect(events[1].seq).toBe(1);
    expect(await store.getLastSeq(runId)).toBe(1);
  });

  it('returns duplicate=false when appending the same run/seq twice', async () => {
    const store = new DrizzleEventStore(db as never);
    const first = await store.append({
      runId,
      eventType: 'text-delta',
      payload: { type: 'text-delta', content: 'Hello' },
      seq: 0,
    });
    const second = await store.append({
      runId,
      eventType: 'text-delta',
      payload: { type: 'text-delta', content: 'Hello again' },
      seq: 0,
    });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);

    const rows = await db.select().from(runEvents).where(eq(runEvents.runId, runId));
    expect(rows).toHaveLength(1);
  });
});
