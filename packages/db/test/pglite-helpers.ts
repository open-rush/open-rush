import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/schema/index.js';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const TABLE_NAMES = [
  'vault_entries',
  'artifacts',
  'run_checkpoints',
  'run_events',
  'runs',
  'sandboxes',
  'agents',
  'project_members',
  'projects',
  'sessions',
  'accounts',
  'verification_tokens',
  'users',
] as const;

export async function createTestDb(): Promise<{ db: TestDb; pglite: PGlite }> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });

  await applySchema(db);

  return { db, pglite };
}

async function applySchema(db: TestDb): Promise<void> {
  // PGlite supports gen_random_uuid() natively (PG 14+), no extensions needed

  // Users
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

  // Accounts
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_account_id)
    )
  `);

  // Sessions
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_token TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  // Verification tokens
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (identifier, token)
    )
  `);

  // Projects
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Project members
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, user_id)
    )
  `);

  // Agents
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      custom_title VARCHAR(200),
      config JSONB,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      active_stream_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Runs
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

  // Run events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS run_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB,
      seq BIGINT NOT NULL,
      schema_version VARCHAR(10) NOT NULL DEFAULT '1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(run_id, seq)
    )
  `);

  // Run checkpoints
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS run_checkpoints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
      messages_snapshot_ref TEXT,
      workspace_delta_ref TEXT,
      last_event_seq BIGINT,
      pending_tool_calls JSONB,
      degraded_recovery BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Sandboxes
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sandboxes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      external_id VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'creating',
      provider_type VARCHAR(50) NOT NULL DEFAULT 'opensandbox',
      endpoint TEXT,
      ttl_seconds INTEGER,
      labels JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      destroyed_at TIMESTAMPTZ
    )
  `);

  // Artifacts
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      kind VARCHAR(50) NOT NULL,
      path TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      content_type VARCHAR(255) NOT NULL,
      size INTEGER NOT NULL,
      checksum VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Vault entries
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vault_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope VARCHAR(20) NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      credential_type VARCHAR(50) NOT NULL DEFAULT 'env',
      encrypted_value TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      injection_target VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((scope = 'platform' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL)),
      UNIQUE(scope, project_id, name)
    )
  `);

  // Partial unique index for platform-scope entries (NULL project_id)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vault_entries_platform_name_uniq
    ON vault_entries (scope, name) WHERE project_id IS NULL
  `);
}

export async function truncateAll(db: TestDb): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLE_NAMES.join(', ')} CASCADE`));
}

export async function closeTestDb(pglite: PGlite): Promise<void> {
  await pglite.close();
}
