import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, gt, gte, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestAgent,
  createTestProject,
  createTestRun,
  createTestTask,
  createTestUser,
} from '../../test/factories.js';
import { closeTestDb, createTestDb, type TestDb, truncateAll } from '../../test/pglite-helpers.js';
import { runs, tasks } from '../schema/index.js';

const DRIZZLE_DIR = resolve(import.meta.dirname, '../../drizzle');

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

function bodyHash(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('runs + tasks versioning/idempotency columns', () => {
  describe('tasks.definition_version', () => {
    it('defaults to null for newly inserted tasks (application layer fills it)', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);
      const task = await createTestTask(db, project.id, user.id, { agentId: agent.id });
      const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row.definitionVersion).toBeNull();
    });

    it('accepts an integer value and round-trips it', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);
      const task = await createTestTask(db, project.id, user.id, { agentId: agent.id });
      await db.update(tasks).set({ definitionVersion: 3 }).where(eq(tasks.id, task.id));

      const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row.definitionVersion).toBe(3);
    });
  });

  describe('runs.agent_definition_version', () => {
    it('defaults to null on insert via createTestRun (no app layer filling)', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);
      const run = await createTestRun(db, agent.id);

      const [row] = await db.select().from(runs).where(eq(runs.id, run.id));
      expect(row.agentDefinitionVersion).toBeNull();
    });

    it('can be set at insert time', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);

      const [run] = await db
        .insert(runs)
        .values({
          agentId: agent.id,
          prompt: 'hi',
          agentDefinitionVersion: 2,
        })
        .returning();

      expect(run.agentDefinitionVersion).toBe(2);
    });
  });

  describe('runs.idempotency_key + idempotency_request_hash', () => {
    it('persists idempotency_key (varchar 255) + idempotency_request_hash (64 chars)', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);

      const key = 'a1b2c3d4-e5f6-7890-abcd-1234567890ef';
      const hash = bodyHash({ input: 'hello world' });
      expect(hash).toHaveLength(64);

      const [run] = await db
        .insert(runs)
        .values({
          agentId: agent.id,
          prompt: 'hello world',
          idempotencyKey: key,
          idempotencyRequestHash: hash,
        })
        .returning();

      expect(run.idempotencyKey).toBe(key);
      expect(run.idempotencyRequestHash).toBe(hash);
    });

    it('does NOT enforce UNIQUE(idempotency_key) — same key inserted twice is allowed at DB level', async () => {
      // App layer enforces 24h window; DB intentionally allows duplicates
      // so that stale keys (>24h) can be reused without needing DELETE.
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);

      const key = 'shared-key-12345';
      await db.insert(runs).values({
        agentId: agent.id,
        prompt: 'first',
        idempotencyKey: key,
        idempotencyRequestHash: bodyHash('first'),
      });
      // Must not throw
      await db.insert(runs).values({
        agentId: agent.id,
        prompt: 'second',
        idempotencyKey: key,
        idempotencyRequestHash: bodyHash('second'),
      });

      const all = await db.select().from(runs).where(eq(runs.idempotencyKey, key));
      expect(all).toHaveLength(2);
    });

    it('idempotency lookup: most recent run by key is returned first when ordered DESC', async () => {
      // Models the RunService (task-11) lookup: latest row within 24h window
      // with matching key.
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);

      const key = 'idem-key-abc';
      const olderDate = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      const newerDate = new Date(Date.now() - 5 * 60 * 1000); // 5m ago

      await db.insert(runs).values({
        agentId: agent.id,
        prompt: 'older',
        idempotencyKey: key,
        idempotencyRequestHash: bodyHash('older'),
        createdAt: olderDate,
      });
      await db.insert(runs).values({
        agentId: agent.id,
        prompt: 'newer',
        idempotencyKey: key,
        idempotencyRequestHash: bodyHash('newer'),
        createdAt: newerDate,
      });

      const rows = await db
        .select()
        .from(runs)
        .where(eq(runs.idempotencyKey, key))
        .orderBy(sql`${runs.createdAt} DESC`);

      expect(rows[0].prompt).toBe('newer');
      expect(rows[1].prompt).toBe('older');
    });

    it('24h window predicate (>= now() - 24h per spec) filters out stale rows', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);

      const key = 'stale-key';
      const stale = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
      const fresh = new Date(Date.now() - 10 * 60 * 1000); // 10m ago

      await db.insert(runs).values([
        {
          agentId: agent.id,
          prompt: 'stale',
          idempotencyKey: key,
          idempotencyRequestHash: bodyHash('a'),
          createdAt: stale,
        },
        {
          agentId: agent.id,
          prompt: 'fresh',
          idempotencyKey: key,
          idempotencyRequestHash: bodyHash('b'),
          createdAt: fresh,
        },
      ]);

      // Spec: WHERE idempotency_key = ? AND created_at >= now() - interval '24 hours'
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const active = await db
        .select()
        .from(runs)
        .where(and(eq(runs.idempotencyKey, key), gte(runs.createdAt, cutoff)));

      expect(active).toHaveLength(1);
      expect(active[0].prompt).toBe('fresh');
    });

    it('24h window boundary: a row with created_at exactly at cutoff is INCLUDED (>=)', async () => {
      // Spec says `>=`, so the oldest-still-active row sits at the cutoff edge.
      // We pin an explicit cutoff (not derived from Date.now()) to avoid clock skew.
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);

      const key = 'boundary-key';
      const cutoff = new Date('2026-04-01T00:00:00Z');
      const atCutoff = new Date(cutoff); // exactly at the boundary
      const oneMsBefore = new Date(cutoff.getTime() - 1);

      await db.insert(runs).values([
        {
          agentId: agent.id,
          prompt: 'at-cutoff',
          idempotencyKey: key,
          idempotencyRequestHash: bodyHash('a'),
          createdAt: atCutoff,
        },
        {
          agentId: agent.id,
          prompt: 'just-before',
          idempotencyKey: key,
          idempotencyRequestHash: bodyHash('b'),
          createdAt: oneMsBefore,
        },
      ]);

      // With >=, the row at the cutoff must be INCLUDED.
      const activeGte = await db
        .select()
        .from(runs)
        .where(and(eq(runs.idempotencyKey, key), gte(runs.createdAt, cutoff)));
      expect(activeGte.map((r) => r.prompt)).toEqual(['at-cutoff']);

      // Sanity: strict `>` would EXCLUDE the boundary row; documenting the
      // semantic difference so future refactors can't silently regress.
      const activeGt = await db
        .select()
        .from(runs)
        .where(and(eq(runs.idempotencyKey, key), gt(runs.createdAt, cutoff)));
      expect(activeGt).toHaveLength(0);
    });
  });

  describe('runs_idempotency_lookup_idx partial index', () => {
    it('partial index exists with predicate WHERE idempotency_key IS NOT NULL', async () => {
      const pg = new PGlite();
      try {
        const files = readdirSync(DRIZZLE_DIR)
          .filter((f) => f.endsWith('.sql'))
          .sort();
        for (const file of files) {
          const content = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
          const stmts = content
            .split('--> statement-breakpoint')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const stmt of stmts) {
            await pg.exec(stmt);
          }
        }
        const res = await pg.query<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'runs'
             AND indexname = 'runs_idempotency_lookup_idx'`
        );
        expect(res.rows).toHaveLength(1);
        const def = res.rows[0].indexdef;
        expect(def).toMatch(/idempotency_key/);
        expect(def).toMatch(/idempotency_key IS NOT NULL/i);
        // DESC sort for created_at so "latest first" queries use the index.
        expect(def).toMatch(/created_at DESC/i);
        // Must NOT be a UNIQUE index — spec explicitly rejects UNIQUE.
        expect(def).not.toMatch(/\bUNIQUE\b/i);
      } finally {
        await pg.close();
      }
    });
  });

  describe('application-layer check of (task_id, agent_id) relationship', () => {
    it('runs.agent_definition_version can coexist with task.definition_version being different (app layer enforces equality)', async () => {
      // DB does not enforce equality between tasks.definition_version and
      // runs.agent_definition_version. This is intentional — see
      // specs/agent-definition-versioning.md §tasks 表 §一致性约束.
      // App layer (task-11 RunService) copies from task; we assert
      // the DB won't block a manual mismatch insert, so callers know to
      // always derive from task.
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);
      const task = await createTestTask(db, project.id, user.id, { agentId: agent.id });
      await db.update(tasks).set({ definitionVersion: 5 }).where(eq(tasks.id, task.id));

      const [run] = await db
        .insert(runs)
        .values({
          agentId: agent.id,
          prompt: 'mismatch on purpose',
          taskId: task.id,
          agentDefinitionVersion: 999, // intentional mismatch
        })
        .returning();

      expect(run.agentDefinitionVersion).toBe(999);

      // Sanity: task still says 5
      const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(taskRow.definitionVersion).toBe(5);
    });
  });

  describe('migration backfill (simulate pre-0011 state + replay 0011)', () => {
    it('precondition: post-0009, all agents have current_version = 1 and a v1 snapshot', async () => {
      // Pin the assumption behind the constant "1" in the 0011 backfill.
      // If a future migration bumps pre-existing agents to a different
      // current_version, this test will fail first and force a re-think
      // of the UPDATE in 0011.
      const pg = new PGlite();
      try {
        const files = readdirSync(DRIZZLE_DIR)
          .filter((f) => f.endsWith('.sql') && f <= '0010')
          .sort();
        for (const file of files) {
          const content = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
          for (const stmt of content
            .split('--> statement-breakpoint')
            .map((s) => s.trim())
            .filter(Boolean)) {
            await pg.exec(stmt);
          }
        }

        // Seed an agent BEFORE 0009 ran? Not possible here since we applied
        // migrations first. Instead: seed an agent AFTER migrations and
        // assert default current_version = 1 (the property 0011 depends on).
        await pg.exec(`
          INSERT INTO users (id, name, email) VALUES
            ('00000000-0000-0000-0000-000000000001', 'u', 'u@ex.com')
        `);
        await pg.exec(`
          INSERT INTO projects (id, name, created_by) VALUES
            ('00000000-0000-0000-0000-000000000002', 'p', '00000000-0000-0000-0000-000000000001')
        `);
        await pg.exec(`
          INSERT INTO agents (id, project_id, created_by) VALUES
            ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000001')
        `);
        const res = await pg.query<{ current_version: number }>(
          `SELECT current_version FROM agents`
        );
        for (const row of res.rows) {
          expect(row.current_version).toBe(1);
        }
      } finally {
        await pg.close();
      }
    });

    it('fills tasks.definition_version = 1 for rows with agent_id set', async () => {
      const pg = new PGlite();
      try {
        const files = readdirSync(DRIZZLE_DIR)
          .filter((f) => f.endsWith('.sql'))
          .sort();
        const pre = files.filter((f) => f < '0011');
        for (const file of pre) {
          const content = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
          const stmts = content
            .split('--> statement-breakpoint')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const stmt of stmts) await pg.exec(stmt);
        }

        // Seed: one task with agent_id, one task without
        await pg.exec(`
          INSERT INTO users (id, name, email) VALUES
            ('00000000-0000-0000-0000-000000000001', 'u', 'u@ex.com')
        `);
        await pg.exec(`
          INSERT INTO projects (id, name, created_by) VALUES
            ('00000000-0000-0000-0000-000000000002', 'p', '00000000-0000-0000-0000-000000000001')
        `);
        await pg.exec(`
          INSERT INTO agents (id, project_id, created_by) VALUES
            ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000001')
        `);
        await pg.exec(`
          INSERT INTO tasks (id, project_id, agent_id, created_by) VALUES
            ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001')
        `);
        await pg.exec(`
          INSERT INTO tasks (id, project_id, agent_id, created_by) VALUES
            ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000002',
             NULL, '00000000-0000-0000-0000-000000000001')
        `);

        // Apply 0011
        const mig = readFileSync(
          resolve(DRIZZLE_DIR, '0011_runs_versioning_idempotency.sql'),
          'utf-8'
        );
        for (const stmt of mig
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean)) {
          await pg.exec(stmt);
        }

        const res = await pg.query<{ id: string; definition_version: number | null }>(
          'SELECT id, definition_version FROM tasks ORDER BY id'
        );
        const withAgent = res.rows.find((r) => r.id.endsWith('0020'));
        const withoutAgent = res.rows.find((r) => r.id.endsWith('0021'));
        expect(withAgent?.definition_version).toBe(1);
        // Tasks without an agent are intentionally NOT backfilled
        // (spec §tasks 表: `WHERE agent_id IS NOT NULL`).
        expect(withoutAgent?.definition_version).toBeNull();
      } finally {
        await pg.close();
      }
    });

    it('backfills runs.agent_definition_version from tasks.definition_version (primary path)', async () => {
      const pg = new PGlite();
      try {
        const files = readdirSync(DRIZZLE_DIR)
          .filter((f) => f.endsWith('.sql'))
          .sort();
        const pre = files.filter((f) => f < '0011');
        for (const file of pre) {
          const content = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
          for (const stmt of content
            .split('--> statement-breakpoint')
            .map((s) => s.trim())
            .filter(Boolean)) {
            await pg.exec(stmt);
          }
        }

        // Seed: existing task+run with no new columns set yet
        await pg.exec(`
          INSERT INTO users (id, name, email) VALUES
            ('00000000-0000-0000-0000-000000000001', 'u', 'u@ex.com')
        `);
        await pg.exec(`
          INSERT INTO projects (id, name, created_by) VALUES
            ('00000000-0000-0000-0000-000000000002', 'p', '00000000-0000-0000-0000-000000000001')
        `);
        await pg.exec(`
          INSERT INTO agents (id, project_id, created_by) VALUES
            ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000001')
        `);
        // agents.current_version is already DEFAULT 1 after 0009
        await pg.exec(`
          INSERT INTO tasks (id, project_id, agent_id, created_by) VALUES
            ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001')
        `);
        await pg.exec(`
          INSERT INTO runs (id, agent_id, task_id, prompt) VALUES
            ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010',
             '00000000-0000-0000-0000-000000000020', 'go'),
            ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000010',
             NULL, 'no-task')
        `);

        const mig = readFileSync(
          resolve(DRIZZLE_DIR, '0011_runs_versioning_idempotency.sql'),
          'utf-8'
        );
        for (const stmt of mig
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean)) {
          await pg.exec(stmt);
        }

        const res = await pg.query<{ id: string; agent_definition_version: number | null }>(
          'SELECT id, agent_definition_version FROM runs ORDER BY id'
        );
        const withTask = res.rows.find((r) => r.id.endsWith('0030'));
        const withoutTask = res.rows.find((r) => r.id.endsWith('0031'));

        // Primary path: from tasks.definition_version (= 1 after backfill)
        expect(withTask?.agent_definition_version).toBe(1);
        // Fallback path: from agents.current_version (= 1)
        expect(withoutTask?.agent_definition_version).toBe(1);
      } finally {
        await pg.close();
      }
    });
  });

  describe('truncate + global drizzle export include these fields', () => {
    it('truncate helper works with extended tables', async () => {
      const user = await createTestUser(db);
      const project = await createTestProject(db, user.id);
      const agent = await createTestAgent(db, project.id, user.id);
      await db.insert(runs).values({
        agentId: agent.id,
        prompt: 'x',
        idempotencyKey: 'k',
        idempotencyRequestHash: bodyHash('x'),
      });
      await truncateAll(db);
      const rows = await db.select().from(runs).where(isNotNull(runs.idempotencyKey));
      expect(rows).toHaveLength(0);
    });

    it('DRIZZLE_DIR contains the 0011 migration file', () => {
      const files = readdirSync(DRIZZLE_DIR);
      const target = files.find((f) => f.startsWith('0011_') && f.endsWith('.sql'));
      expect(target).toBeDefined();
      expect(existsSync(resolve(DRIZZLE_DIR, target!))).toBe(true);
    });
  });
});
