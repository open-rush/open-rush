import { agents, projectMembers, projects, runEvents, runs, users } from '../src/schema/index.js';
import type { TestDb } from './pglite-helpers.js';

export async function createTestUser(db: TestDb, overrides?: { name?: string; email?: string }) {
  const [user] = await db
    .insert(users)
    .values({
      name: overrides?.name ?? 'Test User',
      email: overrides?.email ?? `test-${Date.now()}@example.com`,
    })
    .returning();
  return user;
}

export async function createTestProject(
  db: TestDb,
  createdBy: string,
  overrides?: { name?: string; description?: string }
) {
  const [project] = await db
    .insert(projects)
    .values({
      name: overrides?.name ?? 'Test Project',
      description: overrides?.description ?? 'A test project',
      createdBy,
    })
    .returning();
  return project;
}

export async function createTestMember(
  db: TestDb,
  projectId: string,
  userId: string,
  role: string = 'member'
) {
  const [member] = await db.insert(projectMembers).values({ projectId, userId, role }).returning();
  return member;
}

export async function createTestAgent(db: TestDb, projectId: string, createdBy?: string) {
  const [agent] = await db
    .insert(agents)
    .values({
      projectId,
      createdBy,
    })
    .returning();
  return agent;
}

export async function createTestRun(db: TestDb, agentId: string, overrides?: { prompt?: string }) {
  const [run] = await db
    .insert(runs)
    .values({
      agentId,
      prompt: overrides?.prompt ?? 'Test prompt',
    })
    .returning();
  return run;
}

export async function createTestRunEvent(
  db: TestDb,
  runId: string,
  seq: number,
  overrides?: { eventType?: string; payload?: unknown }
) {
  const [event] = await db
    .insert(runEvents)
    .values({
      runId,
      seq,
      eventType: overrides?.eventType ?? 'message',
      payload: overrides?.payload ?? { text: 'hello' },
    })
    .returning();
  return event;
}
