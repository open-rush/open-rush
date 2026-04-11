import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestAgent,
  createTestMember,
  createTestProject,
  createTestRun,
  createTestRunEvent,
  createTestUser,
} from '../../test/factories.js';
import { closeTestDb, createTestDb, type TestDb, truncateAll } from '../../test/pglite-helpers.js';
import {
  accounts,
  agents,
  projectMembers,
  runEvents,
  runs,
  users,
  vaultEntries,
} from '../schema/index.js';

let db: TestDb;
let pglite: PGlite;

beforeAll(async () => {
  const result = await createTestDb();
  db = result.db;
  pglite = result.pglite;
});

afterAll(async () => {
  await closeTestDb(pglite);
});

beforeEach(async () => {
  await truncateAll(db);
});

describe('users CRUD', () => {
  it('inserts and queries a user', async () => {
    const user = await createTestUser(db, { name: 'Alice', email: 'alice@example.com' });
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.id).toBeTruthy();

    const [found] = await db.select().from(users).where(eq(users.id, user.id));
    expect(found.name).toBe('Alice');
  });

  it('enforces unique email', async () => {
    await createTestUser(db, { email: 'dup@example.com' });
    await expect(createTestUser(db, { email: 'dup@example.com' })).rejects.toThrow();
  });
});

describe('accounts FK cascade', () => {
  it('deletes accounts when user is deleted', async () => {
    const user = await createTestUser(db);
    await db.insert(accounts).values({
      userId: user.id,
      type: 'oauth',
      provider: 'github',
      providerAccountId: '12345',
    });

    await db.delete(users).where(eq(users.id, user.id));
    const remaining = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('projects + members', () => {
  it('creates project with owner member', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const member = await createTestMember(db, project.id, user.id, 'owner');

    expect(member.role).toBe('owner');

    const [found] = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, project.id));
    expect(found.userId).toBe(user.id);
  });

  it('enforces unique (project_id, user_id)', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    await createTestMember(db, project.id, user.id);
    await expect(createTestMember(db, project.id, user.id)).rejects.toThrow();
  });
});

describe('agent → run → run_events chain', () => {
  it('creates full lifecycle chain', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const agent = await createTestAgent(db, project.id, user.id);
    const run = await createTestRun(db, agent.id, { prompt: 'Build a web app' });
    const event1 = await createTestRunEvent(db, run.id, 1, { eventType: 'tool_call' });
    const event2 = await createTestRunEvent(db, run.id, 2, { eventType: 'message' });

    expect(run.status).toBe('queued');
    expect(run.provider).toBe('claude-code');
    expect(event1.seq).toBe(1);
    expect(event2.seq).toBe(2);
  });

  it('enforces unique (run_id, seq) on events', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const agent = await createTestAgent(db, project.id);
    const run = await createTestRun(db, agent.id);

    await createTestRunEvent(db, run.id, 1);
    await expect(createTestRunEvent(db, run.id, 1)).rejects.toThrow();
  });

  it('cascades delete from agent to runs and events', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const agent = await createTestAgent(db, project.id);
    const run = await createTestRun(db, agent.id);
    await createTestRunEvent(db, run.id, 1);

    await db.delete(agents).where(eq(agents.id, agent.id));

    const remainingRuns = await db.select().from(runs).where(eq(runs.agentId, agent.id));
    const remainingEvents = await db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(remainingRuns).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
  });
});

describe('vault_entries scope check', () => {
  it('allows platform scope with null project_id', async () => {
    const [entry] = await db
      .insert(vaultEntries)
      .values({
        scope: 'platform',
        projectId: null,
        name: 'API_KEY',
        encryptedValue: 'enc:xxx',
      })
      .returning();
    expect(entry.scope).toBe('platform');
  });

  it('allows project scope with valid project_id', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    const [entry] = await db
      .insert(vaultEntries)
      .values({
        scope: 'project',
        projectId: project.id,
        name: 'DB_PASSWORD',
        encryptedValue: 'enc:yyy',
      })
      .returning();
    expect(entry.projectId).toBe(project.id);
  });

  it('rejects platform scope with non-null project_id', async () => {
    const user = await createTestUser(db);
    const project = await createTestProject(db, user.id);
    await expect(
      db.insert(vaultEntries).values({
        scope: 'platform',
        projectId: project.id,
        name: 'BAD',
        encryptedValue: 'enc:zzz',
      })
    ).rejects.toThrow();
  });

  it('rejects project scope with null project_id', async () => {
    await expect(
      db.insert(vaultEntries).values({
        scope: 'project',
        projectId: null,
        name: 'BAD',
        encryptedValue: 'enc:zzz',
      })
    ).rejects.toThrow();
  });
});
