import { PGlite } from '@electric-sql/pglite';
import * as schema from '@rush/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleProjectDb } from '../project/drizzle-project-db.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let projectDb: DrizzleProjectDb;
let testUserId: string;

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
    CREATE TABLE IF NOT EXISTS project_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, user_id)
    )
  `);

  const [user] = await db
    .insert(schema.users)
    .values({ name: 'Test User', email: 'test@example.com' })
    .returning();
  testUserId = user.id;
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM project_members`);
  await db.execute(sql`DELETE FROM projects`);
  projectDb = new DrizzleProjectDb(db as never);
});

afterAll(async () => {
  await pglite.close();
});

describe('DrizzleProjectDb', () => {
  describe('create', () => {
    it('creates a project with defaults', async () => {
      const project = await projectDb.create({ name: 'Test Project', createdBy: testUserId });
      expect(project.name).toBe('Test Project');
      expect(project.sandboxProvider).toBe('opensandbox');
      expect(project.defaultConnectionMode).toBe('anthropic');
      expect(project.deletedAt).toBeNull();
    });

    it('creates a project with custom fields', async () => {
      const project = await projectDb.create({
        name: 'Custom',
        description: 'A description',
        sandboxProvider: 'docker',
        createdBy: testUserId,
      });
      expect(project.description).toBe('A description');
      expect(project.sandboxProvider).toBe('docker');
    });
  });

  describe('findById', () => {
    it('returns project by id', async () => {
      const created = await projectDb.create({ name: 'Find Me', createdBy: testUserId });
      const found = await projectDb.findById(created.id);
      expect(found?.name).toBe('Find Me');
    });

    it('returns null for non-existent id', async () => {
      const found = await projectDb.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findByUser (membership + createdBy fallback)', () => {
    it('returns projects where user is a member', async () => {
      const p1 = await projectDb.create({ name: 'Project 1', createdBy: testUserId });

      // Add user as member of p1
      await db
        .insert(schema.projectMembers)
        .values({ projectId: p1.id, userId: testUserId, role: 'owner' });

      const found = await projectDb.findByUser(testUserId);
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(p1.id);
    });

    it('returns projects where user is creator even without membership row (legacy fallback)', async () => {
      // Project with createdBy but no membership row (legacy scenario)
      await projectDb.create({ name: 'Legacy Project', createdBy: testUserId });

      const found = await projectDb.findByUser(testUserId);
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('Legacy Project');
    });

    it('excludes soft-deleted projects', async () => {
      const p = await projectDb.create({ name: 'To Delete', createdBy: testUserId });
      await db
        .insert(schema.projectMembers)
        .values({ projectId: p.id, userId: testUserId, role: 'owner' });
      await projectDb.softDelete(p.id);

      const found = await projectDb.findByUser(testUserId);
      expect(found).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('updates project fields', async () => {
      const p = await projectDb.create({ name: 'Original', createdBy: testUserId });
      const updated = await projectDb.update(p.id, { name: 'Updated', description: 'New desc' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.description).toBe('New desc');
    });
  });

  describe('softDelete + restore', () => {
    it('soft deletes and restores', async () => {
      const p = await projectDb.create({ name: 'Deletable', createdBy: testUserId });

      const deleted = await projectDb.softDelete(p.id);
      expect(deleted).toBe(true);

      const afterDelete = await projectDb.findById(p.id);
      expect(afterDelete?.deletedAt).not.toBeNull();

      const restored = await projectDb.restore(p.id);
      expect(restored).toBe(true);

      const afterRestore = await projectDb.findById(p.id);
      expect(afterRestore?.deletedAt).toBeNull();
    });

    it('hardDelete removes permanently', async () => {
      const p = await projectDb.create({ name: 'Gone', createdBy: testUserId });
      await projectDb.softDelete(p.id);
      const deleted = await projectDb.hardDelete(p.id);
      expect(deleted).toBe(true);

      const found = await projectDb.findById(p.id);
      expect(found).toBeNull();
    });
  });

  describe('listDeleted', () => {
    it('lists only soft-deleted projects by user', async () => {
      const _p1 = await projectDb.create({ name: 'Active', createdBy: testUserId });
      const p2 = await projectDb.create({ name: 'Deleted', createdBy: testUserId });
      await projectDb.softDelete(p2.id);

      const trash = await projectDb.listDeleted(testUserId);
      expect(trash).toHaveLength(1);
      expect(trash[0].name).toBe('Deleted');
    });
  });
});
