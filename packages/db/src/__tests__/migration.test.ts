import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';

const DRIZZLE_DIR = resolve(import.meta.dirname, '../../drizzle');

describe('migration files', () => {
  it('drizzle directory exists', () => {
    expect(existsSync(DRIZZLE_DIR)).toBe(true);
  });

  it('has at least one migration', () => {
    const files = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('migrations are sequentially numbered', () => {
    const files = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (let i = 0; i < files.length; i++) {
      const prefix = files[i].split('_')[0];
      expect(prefix).toBe(String(i).padStart(4, '0'));
    }
  });

  it('meta directory exists with journal', () => {
    const metaDir = resolve(DRIZZLE_DIR, 'meta');
    expect(existsSync(metaDir)).toBe(true);
    expect(existsSync(resolve(metaDir, '_journal.json'))).toBe(true);
  });
});

describe('migration replay on clean database', () => {
  let pglite: PGlite;

  afterAll(async () => {
    await pglite?.close();
  });

  it('all migrations replay successfully on a clean PGlite instance', async () => {
    pglite = new PGlite();

    const files = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sqlContent = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
      const statements = sqlContent
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        await pglite.exec(stmt);
      }
    }

    const result = await pglite.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const tables = result.rows.map((r) => r.tablename);

    expect(tables).toContain('users');
    expect(tables).toContain('projects');
    expect(tables).toContain('tasks');
    expect(tables).toContain('runs');
    expect(tables).toContain('agents');
    expect(tables).toContain('run_events');
    expect(tables).toContain('sandboxes');
    expect(tables).toContain('vault_entries');
    expect(tables).toContain('agent_definition_versions');
    expect(tables).toContain('service_tokens');
  });

  it('service_tokens partial active index exists with correct predicate', async () => {
    const pg = new PGlite();
    try {
      const files = readdirSync(DRIZZLE_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sqlContent = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
        const statements = sqlContent
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          await pg.exec(stmt);
        }
      }

      const result = await pg.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'service_tokens'`
      );
      const idxs = result.rows;
      const activeIdx = idxs.find((r) => r.indexname === 'service_tokens_active_idx');
      expect(activeIdx).toBeDefined();
      expect(activeIdx?.indexdef).toMatch(/revoked_at IS NULL/i);

      const uniqIdx = idxs.find((r) => r.indexname === 'service_tokens_token_hash_uniq');
      expect(uniqIdx).toBeDefined();
      expect(uniqIdx?.indexdef).toMatch(/UNIQUE/i);

      const ownerIdx = idxs.find((r) => r.indexname === 'service_tokens_owner_idx');
      expect(ownerIdx).toBeDefined();
    } finally {
      await pg.close();
    }
  });

  it('agents table gains current_version/archived_at via 0009 migration', async () => {
    const pg = new PGlite();
    try {
      const files = readdirSync(DRIZZLE_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sqlContent = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
        const statements = sqlContent
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          await pg.exec(stmt);
        }
      }

      const result = await pg.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'agents'
         ORDER BY column_name`
      );
      const cols = result.rows.map((r) => r.column_name);
      expect(cols).toContain('current_version');
      expect(cols).toContain('archived_at');
    } finally {
      await pg.close();
    }
  });

  it('initial-snapshot backfill inserts a v1 row for every pre-existing agent', async () => {
    const pg = new PGlite();
    try {
      const files = readdirSync(DRIZZLE_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      // Apply migrations up to (but excluding) the 0009 one that backfills snapshots
      const preMigrations = files.filter((f) => f < '0009');
      for (const file of preMigrations) {
        const sqlContent = readFileSync(resolve(DRIZZLE_DIR, file), 'utf-8');
        const statements = sqlContent
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          await pg.exec(stmt);
        }
      }

      // Seed a project + user + agent BEFORE 0009 runs, to simulate existing data
      await pg.exec(`
        INSERT INTO users (id, name, email) VALUES
          ('00000000-0000-0000-0000-000000000001', 'seed', 'seed@example.com')
      `);
      await pg.exec(`
        INSERT INTO projects (id, name, created_by) VALUES
          ('00000000-0000-0000-0000-000000000002', 'seed-project', '00000000-0000-0000-0000-000000000001')
      `);
      await pg.exec(`
        INSERT INTO agents (id, project_id, created_by) VALUES
          ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
          ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')
      `);

      // Now apply 0009
      const content = readFileSync(
        resolve(DRIZZLE_DIR, '0009_agent_definition_versions.sql'),
        'utf-8'
      );
      const statements = content
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await pg.exec(stmt);
      }

      const versions = await pg.query<{
        agent_id: string;
        version: number;
        snapshot: Record<string, unknown>;
      }>(`SELECT agent_id, version, snapshot FROM agent_definition_versions ORDER BY agent_id`);

      expect(versions.rows).toHaveLength(2);
      for (const row of versions.rows) {
        expect(row.version).toBe(1);
        expect(row.snapshot).toBeTypeOf('object');
        // Snapshot must exclude identity and runtime-state columns per spec.
        expect(row.snapshot).not.toHaveProperty('id');
        expect(row.snapshot).not.toHaveProperty('created_at');
        expect(row.snapshot).not.toHaveProperty('updated_at');
        expect(row.snapshot).not.toHaveProperty('last_active_at');
        expect(row.snapshot).not.toHaveProperty('active_stream_id');
        expect(row.snapshot).not.toHaveProperty('current_version');
        expect(row.snapshot).not.toHaveProperty('archived_at');
      }

      const agentsRes = await pg.query<{ current_version: number; archived_at: string | null }>(
        `SELECT current_version, archived_at FROM agents ORDER BY id`
      );
      for (const row of agentsRes.rows) {
        expect(row.current_version).toBe(1);
        expect(row.archived_at).toBeNull();
      }
    } finally {
      await pg.close();
    }
  });
});
