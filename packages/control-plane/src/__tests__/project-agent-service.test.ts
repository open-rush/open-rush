import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { agents, projects, users } from '@open-rush/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAgentConfigStore } from '../agent/drizzle-agent-config-store.js';
import { ProjectAgentService } from '../agent/project-agent-service.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let pglite: PGlite;

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
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE project_agents, agents, projects, users RESTART IDENTITY CASCADE
  `);
});

describe('DrizzleAgentConfigStore', () => {
  it('creates, updates, lists, and soft deletes project agents', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const store = new DrizzleAgentConfigStore(db as never);

    const created = await store.create({
      id: randomUUID(),
      projectId: project.id,
      name: 'Builder',
      scope: 'project',
      status: 'active',
      systemPrompt: 'Build UI safely.',
      maxSteps: 20,
      deliveryMode: 'workspace',
      createdBy: user.id,
    });

    expect(created.projectId).toBe(project.id);
    expect(created.deliveryMode).toBe('workspace');

    const listed = await store.getProjectAgents(project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Builder');

    const updated = await store.update(created.id, {
      name: 'Updated Builder',
      allowedTools: ['Read', 'Write'],
    });
    expect(updated?.name).toBe('Updated Builder');
    expect(updated?.allowedTools).toEqual(['Read', 'Write']);

    const removed = await store.remove(created.id);
    expect(removed).toBe(true);
    expect(await store.getProjectAgents(project.id)).toHaveLength(0);
  });
});

describe('ProjectAgentService', () => {
  it('switches current agent within a project', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const agentA = await createTestAgent(db, project.id, user.id);
    const agentB = await createTestAgent(db, project.id, user.id);
    const service = new ProjectAgentService(db as never);

    const first = await service.setCurrentAgent(project.id, agentA.id);
    expect(first.agentId).toBe(agentA.id);
    expect(first.isCurrent).toBe(true);

    const second = await service.setCurrentAgent(project.id, agentB.id, { maxSteps: 50 });
    expect(second.agentId).toBe(agentB.id);
    expect(second.isCurrent).toBe(true);
    expect(second.configOverride).toEqual({ maxSteps: 50 });

    const current = await service.getCurrentAgent(project.id);
    expect(current?.agentId).toBe(agentB.id);

    const bindings = await service.listByProject(project.id);
    expect(bindings).toHaveLength(2);
    expect(bindings.filter((binding) => binding.isCurrent)).toHaveLength(1);
  });

  it('rejects binding an agent from another project', async () => {
    const user = await createTestUser(db);
    const projectA = await createTestProject(db, user.id);
    const projectB = await createTestProject(db, user.id);
    const foreignAgent = await createTestAgent(db, projectB.id, user.id);
    const service = new ProjectAgentService(db as never);

    await expect(service.setCurrentAgent(projectA.id, foreignAgent.id)).rejects.toThrow(
      'Agent not found in project'
    );
  });
});

async function createTestUser(db: TestDb): Promise<typeof users.$inferSelect> {
  const [user] = await db
    .insert(users)
    .values({
      name: 'Test User',
      email: `test-${randomUUID()}@example.com`,
    })
    .returning();

  return user;
}

async function createTestProject(
  db: TestDb,
  createdBy: string
): Promise<typeof projects.$inferSelect> {
  const [project] = await db
    .insert(projects)
    .values({
      name: 'Test Project',
      description: 'A test project',
      createdBy,
    })
    .returning();

  return project;
}

async function createTestAgent(
  db: TestDb,
  projectId: string,
  createdBy?: string
): Promise<typeof agents.$inferSelect> {
  const [agent] = await db
    .insert(agents)
    .values({
      projectId,
      createdBy,
    })
    .returning();

  return agent;
}
