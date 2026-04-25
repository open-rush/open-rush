/**
 * AgentDefinitionService integration tests (PGlite-backed, no Docker).
 *
 * The schema bootstrap (users, projects, agents, agent_definition_versions)
 * is inlined here on purpose — we use the same columns + indexes as
 * `packages/db/test/pglite-helpers.ts`, but the control-plane tests have their
 * own inline DDL, as established by drizzle-event-store.test.ts et al. If you
 * touch this block, sync the matching columns in:
 *   - packages/db/test/pglite-helpers.ts
 *   - packages/control-plane/src/__tests__/drizzle-event-store.test.ts
 *   - packages/control-plane/src/__tests__/drizzle-run-db.test.ts
 * (see docs/execution/progress/agent-0.md §Repo 隐性约定 #2.)
 */
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { agentDefinitionVersions, agents, projects, users } from '@open-rush/db';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentDefinitionArchivedError,
  AgentDefinitionNotFoundError,
  AgentDefinitionService,
  AgentDefinitionVersionConflictError,
  AgentDefinitionVersionNotFoundError,
  type CreateAgentDefinitionInput,
  EmptyAgentDefinitionPatchError,
  InvalidAgentDefinitionInputError,
} from '../agent-definition-service.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let service: AgentDefinitionService;
let projectId: string;
let userId: string;

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

  service = new AgentDefinitionService(db as never);
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE agent_definition_versions, agents, projects, users RESTART IDENTITY CASCADE`
  );
  const [user] = await db
    .insert(users)
    .values({ name: 'Alice', email: `alice-${Math.random()}@ex.com` })
    .returning();
  userId = user.id;
  const [project] = await db.insert(projects).values({ name: 'TP', createdBy: userId }).returning();
  projectId = project.id;
});

function makeCreateInput(overrides: Partial<CreateAgentDefinitionInput> = {}) {
  return {
    projectId,
    name: 'Agent 1',
    description: 'desc',
    icon: null,
    providerType: 'claude-code',
    model: null,
    systemPrompt: 'be helpful',
    appendSystemPrompt: null,
    allowedTools: ['Read', 'Bash'],
    skills: [],
    mcpServers: [],
    maxSteps: 30,
    deliveryMode: 'chat',
    config: null,
    createdBy: userId,
    ...overrides,
  } satisfies CreateAgentDefinitionInput;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('AgentDefinitionService.create', () => {
  it('writes an agent row + v1 snapshot in one transaction', async () => {
    const d = await service.create(makeCreateInput({ changeNote: 'initial' }));
    expect(d.currentVersion).toBe(1);
    expect(d.archivedAt).toBeNull();
    expect(d.name).toBe('Agent 1');

    const rows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].changeNote).toBe('initial');
    expect(rows[0].createdBy).toBe(userId);

    // Snapshot contains all editable fields, matching the returned definition.
    const snap = rows[0].snapshot as Record<string, unknown>;
    expect(snap.name).toBe('Agent 1');
    expect(snap.systemPrompt).toBe('be helpful');
    expect(snap.allowedTools).toEqual(['Read', 'Bash']);
    // Must NOT leak bookkeeping columns into snapshot.
    expect(snap).not.toHaveProperty('id');
    expect(snap).not.toHaveProperty('currentVersion');
    expect(snap).not.toHaveProperty('archivedAt');
    expect(snap).not.toHaveProperty('createdAt');
    expect(snap).not.toHaveProperty('updatedAt');
  });

  it('defaults changeNote to null when omitted', async () => {
    const d = await service.create(makeCreateInput());
    const [row] = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id));
    expect(row.changeNote).toBeNull();
  });

  it('stores an empty object config as {}', async () => {
    const d = await service.create(makeCreateInput({ config: { region: 'us-west-2' } }));
    const fresh = await service.get(d.id);
    expect(fresh.config).toEqual({ region: 'us-west-2' });
  });
});

// ---------------------------------------------------------------------------
// get / getByVersion / listVersions
// ---------------------------------------------------------------------------

describe('AgentDefinitionService.get', () => {
  it('returns the latest row', async () => {
    const d = await service.create(makeCreateInput());
    const got = await service.get(d.id);
    expect(got.id).toBe(d.id);
    expect(got.currentVersion).toBe(1);
  });

  it('throws NotFound for unknown id', async () => {
    await expect(service.get('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      AgentDefinitionNotFoundError
    );
  });

  it('returns archived definitions (archived is a state, not a delete)', async () => {
    const d = await service.create(makeCreateInput());
    await service.archive(d.id);
    const got = await service.get(d.id);
    expect(got.archivedAt).toBeInstanceOf(Date);
  });
});

describe('AgentDefinitionService.getByVersion', () => {
  it('returns the historical snapshot merged with stable metadata', async () => {
    const d = await service.create(makeCreateInput({ name: 'v1-name' }));
    await service.patch(d.id, {
      ifMatchVersion: 1,
      name: 'v2-name',
      changeNote: 'rename',
    });

    const v1 = await service.getByVersion(d.id, 1);
    expect(v1.id).toBe(d.id);
    expect(v1.projectId).toBe(projectId);
    expect(v1.currentVersion).toBe(1);
    expect(v1.name).toBe('v1-name');
    // updatedAt on historical = the version row's created_at.
    expect(v1.updatedAt).toBeInstanceOf(Date);

    const v2 = await service.getByVersion(d.id, 2);
    expect(v2.currentVersion).toBe(2);
    expect(v2.name).toBe('v2-name');
  });

  it('throws VersionNotFound for unknown version', async () => {
    const d = await service.create(makeCreateInput());
    await expect(service.getByVersion(d.id, 99)).rejects.toBeInstanceOf(
      AgentDefinitionVersionNotFoundError
    );
  });

  it("throws AgentNotFound first if agent doesn't exist", async () => {
    await expect(
      service.getByVersion('00000000-0000-0000-0000-000000000000', 1)
    ).rejects.toBeInstanceOf(AgentDefinitionNotFoundError);
  });

  it('rejects non-positive version values as VALIDATION_ERROR (not NOT_FOUND)', async () => {
    const d = await service.create(makeCreateInput());
    await expect(service.getByVersion(d.id, 0)).rejects.toBeInstanceOf(
      InvalidAgentDefinitionInputError
    );
    await expect(service.getByVersion(d.id, -1)).rejects.toBeInstanceOf(
      InvalidAgentDefinitionInputError
    );
    await expect(service.getByVersion(d.id, 1.5)).rejects.toBeInstanceOf(
      InvalidAgentDefinitionInputError
    );
    await expect(service.getByVersion(d.id, Number.NaN)).rejects.toBeInstanceOf(
      InvalidAgentDefinitionInputError
    );
  });

  it('reads legacy snake_case v1 snapshot (from 0009 migration)', async () => {
    // Simulate: agent_definition_versions row written by migration 0009 as
    // `to_jsonb(agents.*)` — snake_case keys, including non-editable columns.
    // Confirms getByVersion tolerates both formats without losing fields.
    const d = await service.create(makeCreateInput({ name: 'row-name' }));
    // Overwrite v1 snapshot with a legacy snake_case payload.
    await db
      .update(agentDefinitionVersions)
      .set({
        snapshot: {
          name: 'legacy',
          description: 'legacy-desc',
          icon: 'legacy-icon',
          provider_type: 'legacy-provider',
          model: 'legacy-model',
          system_prompt: 'legacy-prompt',
          append_system_prompt: 'legacy-append',
          allowed_tools: ['LegacyTool'],
          skills: ['legacy-skill'],
          mcp_servers: ['legacy-mcp'],
          max_steps: 7,
          delivery_mode: 'workspace',
          config: { region: 'eu' },
          // Extra non-editable keys that migration also writes (should be ignored).
          status: 'active',
          is_builtin: false,
          custom_title: null,
          created_by: null,
        },
      })
      .where(
        and(eq(agentDefinitionVersions.agentId, d.id), eq(agentDefinitionVersions.version, 1))
      );

    const v1 = await service.getByVersion(d.id, 1);
    expect(v1.name).toBe('legacy');
    expect(v1.description).toBe('legacy-desc');
    expect(v1.icon).toBe('legacy-icon');
    expect(v1.providerType).toBe('legacy-provider');
    expect(v1.model).toBe('legacy-model');
    expect(v1.systemPrompt).toBe('legacy-prompt');
    expect(v1.appendSystemPrompt).toBe('legacy-append');
    expect(v1.allowedTools).toEqual(['LegacyTool']);
    expect(v1.skills).toEqual(['legacy-skill']);
    expect(v1.mcpServers).toEqual(['legacy-mcp']);
    expect(v1.maxSteps).toBe(7);
    expect(v1.deliveryMode).toBe('workspace');
    expect(v1.config).toEqual({ region: 'eu' });
  });
});

describe('AgentDefinitionService.listVersions', () => {
  it('returns versions in descending order without snapshots', async () => {
    const d = await service.create(makeCreateInput({ changeNote: 'v1' }));
    await service.patch(d.id, { ifMatchVersion: 1, name: 'v2', changeNote: 'v2' });
    await service.patch(d.id, { ifMatchVersion: 2, name: 'v3', changeNote: 'v3' });

    const res = await service.listVersions(d.id);
    expect(res.items.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(res.items.map((v) => v.changeNote)).toEqual(['v3', 'v2', 'v1']);
    // Summary must NOT carry snapshot payload.
    expect(res.items[0]).not.toHaveProperty('snapshot');
    expect(res.nextCursor).toBeNull();
  });

  it('paginates by version cursor (smaller than cursor → next page)', async () => {
    const d = await service.create(makeCreateInput());
    for (let v = 1; v < 5; v++) {
      await service.patch(d.id, { ifMatchVersion: v, name: `v${v + 1}` });
    }

    const first = await service.listVersions(d.id, { limit: 2 });
    expect(first.items.map((v) => v.version)).toEqual([5, 4]);
    expect(first.nextCursor).toBe(4);

    const second = await service.listVersions(d.id, { limit: 2, cursorVersion: 4 });
    expect(second.items.map((v) => v.version)).toEqual([3, 2]);
    expect(second.nextCursor).toBe(2);

    const third = await service.listVersions(d.id, { limit: 2, cursorVersion: 2 });
    expect(third.items.map((v) => v.version)).toEqual([1]);
    expect(third.nextCursor).toBeNull();
  });

  it('throws NotFound when agent missing', async () => {
    await expect(
      service.listVersions('00000000-0000-0000-0000-000000000000')
    ).rejects.toBeInstanceOf(AgentDefinitionNotFoundError);
  });

  it('clamps limit to 1..200', async () => {
    const d = await service.create(makeCreateInput());
    const res = await service.listVersions(d.id, { limit: 9999 });
    expect(res.items.length).toBeLessThanOrEqual(200);
    // limit=0 should fall back to default 50.
    const res2 = await service.listVersions(d.id, { limit: 0 });
    expect(res2.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// patch
// ---------------------------------------------------------------------------

describe('AgentDefinitionService.patch', () => {
  it('bumps current_version and inserts snapshot atomically', async () => {
    const d = await service.create(makeCreateInput());
    const updated = await service.patch(d.id, {
      ifMatchVersion: 1,
      name: 'renamed',
      maxSteps: 42,
      changeNote: 'bumped',
      updatedBy: userId,
    });
    expect(updated.currentVersion).toBe(2);
    expect(updated.name).toBe('renamed');
    expect(updated.maxSteps).toBe(42);

    const rows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id))
      .orderBy(agentDefinitionVersions.version);
    expect(rows).toHaveLength(2);
    expect(rows[1].version).toBe(2);
    expect(rows[1].changeNote).toBe('bumped');
    expect((rows[1].snapshot as Record<string, unknown>).name).toBe('renamed');
    expect((rows[1].snapshot as Record<string, unknown>).maxSteps).toBe(42);
    // Unchanged fields carry forward from v1.
    expect((rows[1].snapshot as Record<string, unknown>).systemPrompt).toBe('be helpful');
  });

  it('409 when If-Match mismatches current_version', async () => {
    const d = await service.create(makeCreateInput());
    await expect(service.patch(d.id, { ifMatchVersion: 99, name: 'x' })).rejects.toBeInstanceOf(
      AgentDefinitionVersionConflictError
    );

    // Ensure nothing was written: still v1, one snapshot row.
    const after = await service.get(d.id);
    expect(after.currentVersion).toBe(1);
    const rows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id));
    expect(rows).toHaveLength(1);
  });

  it('simulates concurrent PATCH — only one wins, the other 409s', async () => {
    // NOTE: PGlite runs in a single in-process queue, so this test proves
    // the **service-level optimistic concurrency check**: two PATCHes that
    // both read If-Match=1 cannot both bump to v2, because the second
    // transaction sees `current_version=2` and raises VERSION_CONFLICT.
    //
    // This does NOT prove the PG-level `FOR UPDATE` row lock behaves
    // correctly under true multi-connection concurrency — that is covered
    // by the integration layer (task-8 API route tests on real PG) once
    // Agent-A's task-8 API handler is implemented.
    const d = await service.create(makeCreateInput());
    const first = service.patch(d.id, { ifMatchVersion: 1, name: 'A' });
    const second = service.patch(d.id, { ifMatchVersion: 1, name: 'B' });
    const results = await Promise.allSettled([first, second]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      AgentDefinitionVersionConflictError
    );
    const after = await service.get(d.id);
    expect(after.currentVersion).toBe(2);
  });

  it('rejects PATCH on archived definition', async () => {
    const d = await service.create(makeCreateInput());
    await service.archive(d.id);
    await expect(service.patch(d.id, { ifMatchVersion: 1, name: 'x' })).rejects.toBeInstanceOf(
      AgentDefinitionArchivedError
    );
  });

  it('rejects empty patch (only changeNote / only updatedBy)', async () => {
    const d = await service.create(makeCreateInput());
    await expect(
      service.patch(d.id, { ifMatchVersion: 1, changeNote: 'nothing' })
    ).rejects.toBeInstanceOf(EmptyAgentDefinitionPatchError);
    await expect(
      service.patch(d.id, { ifMatchVersion: 1, updatedBy: userId })
    ).rejects.toBeInstanceOf(EmptyAgentDefinitionPatchError);
  });

  it('rejects PATCH for unknown id', async () => {
    await expect(
      service.patch('00000000-0000-0000-0000-000000000000', {
        ifMatchVersion: 1,
        name: 'x',
      })
    ).rejects.toBeInstanceOf(AgentDefinitionNotFoundError);
  });

  it('rejects invalid ifMatchVersion as VALIDATION_ERROR (not VERSION_CONFLICT)', async () => {
    const d = await service.create(makeCreateInput());
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(
        service.patch(d.id, { ifMatchVersion: bad as number, name: 'x' })
      ).rejects.toBeInstanceOf(InvalidAgentDefinitionInputError);
    }
    // The fact that no version row got appended confirms the short-circuit
    // happened before the DB was touched.
    const rows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id));
    expect(rows).toHaveLength(1);
  });

  it('does not overwrite fields absent from the patch body', async () => {
    const d = await service.create(
      makeCreateInput({ systemPrompt: 'keep me', allowedTools: ['Read'] })
    );
    const updated = await service.patch(d.id, {
      ifMatchVersion: 1,
      name: 'only-name-changed',
    });
    expect(updated.systemPrompt).toBe('keep me');
    expect(updated.allowedTools).toEqual(['Read']);
  });

  it('allows explicit null for nullable fields', async () => {
    const d = await service.create(makeCreateInput({ description: 'had one' }));
    const updated = await service.patch(d.id, {
      ifMatchVersion: 1,
      description: null,
    });
    expect(updated.description).toBeNull();
    const v2 = await service.getByVersion(d.id, 2);
    expect(v2.description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

describe('AgentDefinitionService.archive', () => {
  it('sets archived_at and keeps current_version unchanged', async () => {
    const d = await service.create(makeCreateInput());
    expect(d.archivedAt).toBeNull();
    const archived = await service.archive(d.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.currentVersion).toBe(1);
  });

  it('is idempotent on already-archived rows (no new version, no new archived_at)', async () => {
    const d = await service.create(makeCreateInput());
    const first = await service.archive(d.id);
    const second = await service.archive(d.id);
    expect(second.archivedAt?.getTime()).toBe(first.archivedAt?.getTime());
    const rows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id));
    expect(rows).toHaveLength(1); // archive must not bump versions.
  });

  it('throws NotFound for unknown id', async () => {
    await expect(service.archive('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      AgentDefinitionNotFoundError
    );
  });

  it('cascades to version rows on agent DELETE (FK cascade sanity-check)', async () => {
    const d = await service.create(makeCreateInput());
    await service.patch(d.id, { ifMatchVersion: 1, name: 'v2' });
    await db.delete(agents).where(eq(agents.id, d.id));
    const rows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(eq(agentDefinitionVersions.agentId, d.id));
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: ensure unique (agent_id, version) protects from dup versions
// ---------------------------------------------------------------------------

describe('AgentDefinitionService invariants', () => {
  it('two different agents can share the same version number', async () => {
    const a = await service.create(makeCreateInput({ name: 'A' }));
    const b = await service.create(makeCreateInput({ name: 'B' }));
    expect(a.currentVersion).toBe(1);
    expect(b.currentVersion).toBe(1);
    const rowsA = await db
      .select()
      .from(agentDefinitionVersions)
      .where(
        and(eq(agentDefinitionVersions.agentId, a.id), eq(agentDefinitionVersions.version, 1))
      );
    const rowsB = await db
      .select()
      .from(agentDefinitionVersions)
      .where(
        and(eq(agentDefinitionVersions.agentId, b.id), eq(agentDefinitionVersions.version, 1))
      );
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });

  it('monotonic version per agent', async () => {
    const d = await service.create(makeCreateInput());
    for (let v = 1; v < 5; v++) {
      const updated = await service.patch(d.id, {
        ifMatchVersion: v,
        name: `v${v + 1}`,
      });
      expect(updated.currentVersion).toBe(v + 1);
    }
  });
});
