import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/schema/index.js';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const TABLE_NAMES = [
  'versions',
  'vault_entries',
  'conversations',
  'artifacts',
  'run_checkpoints',
  'run_events',
  'runs',
  'tasks',
  'sandboxes',
  'project_agents',
  'agent_definition_versions',
  'agents',
  'service_tokens',
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

  // Service tokens (machine-to-machine auth for /api/v1/*)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS service_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash TEXT NOT NULL,
      name VARCHAR(255) NOT NULL,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS service_tokens_token_hash_uniq
    ON service_tokens (token_hash)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS service_tokens_owner_idx
    ON service_tokens (owner_user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS service_tokens_active_idx
    ON service_tokens (token_hash) WHERE revoked_at IS NULL
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
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

  // Agent definition versions
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_definition_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      change_note TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT agent_definition_versions_agent_version_uniq UNIQUE(agent_id, version)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agent_definition_versions_agent_idx
    ON agent_definition_versions (agent_id, version DESC)
  `);

  // Project agents
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      is_current BOOLEAN NOT NULL DEFAULT false,
      config_override JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, agent_id)
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS project_agents_current_idx
    ON project_agents (project_id) WHERE is_current = true
  `);

  // Tasks
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      handoff_summary TEXT,
      head_run_id UUID,
      active_run_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks (project_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tasks_project_updated_at_idx ON tasks (project_id, updated_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tasks_head_run_id_idx ON tasks (head_run_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tasks_active_run_id_idx ON tasks (active_run_id)
  `);

  // Conversations
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id UUID,
      agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      summary TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Runs
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS runs_task_id_idx ON runs (task_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS runs_conversation_id_idx ON runs (conversation_id)
  `);
  await db
    .execute(sql`
    ALTER TABLE tasks
    ADD CONSTRAINT tasks_head_run_id_runs_id_fk
    FOREIGN KEY (head_run_id) REFERENCES runs(id) ON DELETE SET NULL
  `)
    .catch(() => {});
  await db
    .execute(sql`
    ALTER TABLE tasks
    ADD CONSTRAINT tasks_active_run_id_runs_id_fk
    FOREIGN KEY (active_run_id) REFERENCES runs(id) ON DELETE SET NULL
  `)
    .catch(() => {});
  await db
    .execute(sql`
    ALTER TABLE conversations
    ADD CONSTRAINT conversations_task_id_tasks_id_fk
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  `)
    .catch(() => {});
  await db
    .execute(sql`
    ALTER TABLE runs
    ADD CONSTRAINT runs_task_id_tasks_id_fk
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  `)
    .catch(() => {});
  await db
    .execute(sql`
    ALTER TABLE runs
    ADD CONSTRAINT runs_conversation_id_conversations_id_fk
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  `)
    .catch(() => {});

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
      credential_type VARCHAR(50) NOT NULL DEFAULT 'env_var',
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

  // Versions
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'building',
      title TEXT,
      artifact_path TEXT,
      artifact_size INTEGER,
      build_log TEXT,
      metadata JSONB,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ,
      UNIQUE(project_id, version)
    )
  `);
}

export async function truncateAll(db: TestDb): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLE_NAMES.join(', ')} CASCADE`));
}

export async function closeTestDb(pglite: PGlite): Promise<void> {
  await pglite.close();
}
