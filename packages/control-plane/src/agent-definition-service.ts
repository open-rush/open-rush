/**
 * AgentDefinitionService — versioned CRUD + optimistic concurrency (If-Match)
 * for the AgentDefinition layer (the `agents` table; see
 * specs/agent-definition-versioning.md §数据模型).
 *
 * Consumed by `/api/v1/agent-definitions/*` route handlers (task-8). The service
 * raises domain-specific error classes rather than returning status codes or
 * { ok, err } tuples; route handlers map these to the v1 error envelope.
 *
 * Design notes:
 * - Mutation (create / patch / archive) runs in a single transaction. The PATCH
 *   flow (spec §PATCH 流程) is 6 atomic steps: load current, check If-Match,
 *   merge, insert version row, bump current_version, commit.
 * - Row → domain mapping keeps Dates as `Date` objects. The API route layer
 *   (task-8) converts to ISO strings when serialising with
 *   `agentDefinitionSchema`. Keeping Dates in the service makes it reusable
 *   from contexts that prefer native Date (logs, RunService).
 * - The service accepts a drizzle `DbClient` directly (same pattern as
 *   ProjectAgentService) to keep transaction boundaries explicit. Tests use
 *   the pglite driver with the shared pglite-helpers schema.
 */
import { agentDefinitionVersions, agents, type DbClient } from '@open-rush/db';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

type AgentRow = typeof agents.$inferSelect;
type AgentVersionRow = typeof agentDefinitionVersions.$inferSelect;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * Editable fields present in each version's `snapshot`. Mirrors
 * `agentDefinitionEditableSchema` in `@open-rush/contracts/v1`. The ordering
 * and set of keys must stay in sync; route handlers `.parse()` responses
 * against the Zod schema.
 */
export interface AgentDefinitionEditable {
  name: string;
  description: string | null;
  icon: string | null;
  providerType: string;
  model: string | null;
  systemPrompt: string | null;
  appendSystemPrompt: string | null;
  allowedTools: string[];
  skills: string[];
  mcpServers: string[];
  maxSteps: number;
  deliveryMode: string;
  config: Record<string, unknown> | null;
}

/** Full AgentDefinition as returned by service getters (Dates, not ISO). */
export interface AgentDefinition extends AgentDefinitionEditable {
  id: string;
  projectId: string;
  currentVersion: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Version history summary — no full snapshot payload. */
export interface AgentDefinitionVersionSummary {
  version: number;
  changeNote: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** Input for POST /api/v1/agent-definitions. */
export interface CreateAgentDefinitionInput extends AgentDefinitionEditable {
  projectId: string;
  changeNote?: string | null;
  createdBy?: string | null;
}

/** Input for PATCH /api/v1/agent-definitions/:id (with If-Match). */
export interface PatchAgentDefinitionInput extends Partial<AgentDefinitionEditable> {
  /**
   * If-Match header value — the client-observed version. Must equal
   * `agents.current_version` at the time of write, otherwise 409.
   */
  ifMatchVersion: number;
  changeNote?: string | null;
  updatedBy?: string | null;
}

export interface ListVersionsOptions {
  /** Max rows (1..200), default 50. */
  limit?: number;
  /** Cursor = the lowest `version` returned in the previous page. */
  cursorVersion?: number;
}

export interface ListVersionsResult {
  items: AgentDefinitionVersionSummary[];
  /**
   * The version number to pass as `cursorVersion` in the next page, or `null`
   * if no more rows. Smaller than the smallest `version` in `items`.
   */
  nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AgentDefinitionNotFoundError extends Error {
  public readonly agentId: string;
  constructor(agentId: string) {
    super(`AgentDefinition ${agentId} not found`);
    this.name = 'AgentDefinitionNotFoundError';
    this.agentId = agentId;
  }
}

/**
 * 400 — caller passed a malformed numeric argument (`version`, `ifMatchVersion`,
 * `limit`) where the service can cheaply validate before hitting the DB. Route
 * handlers map this to `VALIDATION_ERROR` (as distinct from NOT_FOUND or
 * VERSION_CONFLICT, which imply the record existed with a different state).
 */
export class InvalidAgentDefinitionInputError extends Error {
  public readonly field: string;
  public readonly value: unknown;
  constructor(field: string, value: unknown, reason: string) {
    super(`Invalid ${field}=${String(value)}: ${reason}`);
    this.name = 'InvalidAgentDefinitionInputError';
    this.field = field;
    this.value = value;
  }
}

export class AgentDefinitionVersionNotFoundError extends Error {
  public readonly agentId: string;
  public readonly version: number;
  constructor(agentId: string, version: number) {
    super(`AgentDefinition ${agentId} version ${version} not found`);
    this.name = 'AgentDefinitionVersionNotFoundError';
    this.agentId = agentId;
    this.version = version;
  }
}

/**
 * 409 — PATCH If-Match did not match `agents.current_version` at write time.
 * Clients should refetch the current version, merge, and retry.
 */
export class AgentDefinitionVersionConflictError extends Error {
  public readonly agentId: string;
  public readonly expected: number;
  public readonly actual: number;
  constructor(agentId: string, expected: number, actual: number) {
    super(`AgentDefinition ${agentId} version conflict: If-Match=${expected}, current=${actual}`);
    this.name = 'AgentDefinitionVersionConflictError';
    this.agentId = agentId;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * 400 — PATCH or archive attempted on an already-archived definition (spec
 * §归档: "归档后不允许 PATCH").
 */
export class AgentDefinitionArchivedError extends Error {
  public readonly agentId: string;
  public readonly archivedAt: Date;
  constructor(agentId: string, archivedAt: Date) {
    super(`AgentDefinition ${agentId} is archived at ${archivedAt.toISOString()}`);
    this.name = 'AgentDefinitionArchivedError';
    this.agentId = agentId;
    this.archivedAt = archivedAt;
  }
}

/**
 * 400 — PATCH body contained only bookkeeping fields (e.g. only changeNote)
 * with no actual editable-field change. The contracts-level Zod refine catches
 * this for HTTP, but service-level callers (RunService, tests) also hit it.
 */
export class EmptyAgentDefinitionPatchError extends Error {
  constructor() {
    super('PATCH must modify at least one editable field');
    this.name = 'EmptyAgentDefinitionPatchError';
  }
}

// ---------------------------------------------------------------------------
// Row ↔ Domain mapping
// ---------------------------------------------------------------------------

const EDITABLE_KEYS: readonly (keyof AgentDefinitionEditable)[] = [
  'name',
  'description',
  'icon',
  'providerType',
  'model',
  'systemPrompt',
  'appendSystemPrompt',
  'allowedTools',
  'skills',
  'mcpServers',
  'maxSteps',
  'deliveryMode',
  'config',
] as const;

function extractEditable(row: AgentRow): AgentDefinitionEditable {
  return {
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    providerType: row.providerType,
    model: row.model ?? null,
    systemPrompt: row.systemPrompt ?? null,
    appendSystemPrompt: row.appendSystemPrompt ?? null,
    allowedTools: row.allowedTools,
    skills: row.skills,
    mcpServers: row.mcpServers,
    maxSteps: row.maxSteps,
    deliveryMode: row.deliveryMode,
    config:
      row.config === null || row.config === undefined
        ? null
        : (row.config as Record<string, unknown>),
  };
}

function rowToDefinition(row: AgentRow): AgentDefinition {
  return {
    ...extractEditable(row),
    id: row.id,
    projectId: row.projectId,
    currentVersion: row.currentVersion,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Keys that are valid for a snapshot payload. Used by the tolerant reader in
 * {@link readSnapshotField} to check both `camelCase` (produced by this
 * service from M2 onward) and `snake_case` (produced by the legacy v1
 * migration — `to_jsonb(agents.*)` in `packages/db/drizzle/0009_...`).
 *
 * The dual-format support MUST remain even if we migrate old snapshots later:
 * (a) existing deployments may never re-run the migration;
 * (b) users may have exported/imported snapshots from elsewhere;
 * (c) the two formats are the same shape, just different key casing.
 */
const SNAKE_KEYS: Record<keyof AgentDefinitionEditable, string> = {
  name: 'name',
  description: 'description',
  icon: 'icon',
  providerType: 'provider_type',
  model: 'model',
  systemPrompt: 'system_prompt',
  appendSystemPrompt: 'append_system_prompt',
  allowedTools: 'allowed_tools',
  skills: 'skills',
  mcpServers: 'mcp_servers',
  maxSteps: 'max_steps',
  deliveryMode: 'delivery_mode',
  config: 'config',
};

function readSnapshotField<K extends keyof AgentDefinitionEditable>(
  snapshot: Record<string, unknown>,
  key: K
): unknown {
  if (key in snapshot) return snapshot[key];
  const snake = SNAKE_KEYS[key];
  if (snake in snapshot) return snapshot[snake];
  return undefined;
}

/**
 * Merge a historical snapshot with its owning agent row. Used by getByVersion:
 * id/projectId/archivedAt/createdAt come from `agents`; the editable fields +
 * `currentVersion` (= N) come from the snapshot row / its `version`.
 *
 * `updatedAt` on a historical snapshot = the version row's `created_at` (i.e.
 * when that version was written). This keeps clients able to sort history by
 * a meaningful timestamp without teaching them about `agent_definition_versions`.
 *
 * Reads BOTH camelCase and snake_case snapshot keys to stay compatible with
 * the v1 migration (`to_jsonb(agents.*)`), which wrote snake_case columns.
 * New snapshots written by {@link AgentDefinitionService.create} and
 * {@link AgentDefinitionService.patch} use camelCase.
 */
function snapshotToDefinition(row: AgentRow, versionRow: AgentVersionRow): AgentDefinition {
  const snapshot = (versionRow.snapshot ?? {}) as Record<string, unknown>;
  const read = <K extends keyof AgentDefinitionEditable>(
    key: K,
    fallback: AgentDefinitionEditable[K]
  ): AgentDefinitionEditable[K] => {
    const v = readSnapshotField(snapshot, key);
    return (v === undefined ? fallback : v) as AgentDefinitionEditable[K];
  };

  const editable: AgentDefinitionEditable = {
    name: read('name', row.name),
    description: read('description', null) as string | null,
    icon: read('icon', null) as string | null,
    providerType: read('providerType', row.providerType),
    model: read('model', null) as string | null,
    systemPrompt: read('systemPrompt', null) as string | null,
    appendSystemPrompt: read('appendSystemPrompt', null) as string | null,
    allowedTools: read('allowedTools', []) as string[],
    skills: read('skills', []) as string[],
    mcpServers: read('mcpServers', []) as string[],
    maxSteps: read('maxSteps', row.maxSteps),
    deliveryMode: read('deliveryMode', row.deliveryMode),
    config: read('config', null) as Record<string, unknown> | null,
  };
  return {
    ...editable,
    id: row.id,
    projectId: row.projectId,
    currentVersion: versionRow.version,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: versionRow.createdAt,
  };
}

function versionRowToSummary(row: AgentVersionRow): AgentDefinitionVersionSummary {
  return {
    version: row.version,
    changeNote: row.changeNote ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Drop undefined-valued keys. Zod `.partial()` preserves undefined when used
 * with `.extend({ changeNote })`, but we must NOT overwrite fields with
 * `undefined` in the DB. Also strips the internal `changeNote` etc. which are
 * not part of the snapshot.
 */
function pickEditablePatch(
  input: Partial<AgentDefinitionEditable>
): Partial<AgentDefinitionEditable> {
  const out: Partial<AgentDefinitionEditable> = {};
  for (const k of EDITABLE_KEYS) {
    if (k in input && (input as Record<string, unknown>)[k] !== undefined) {
      // @ts-expect-error -- key-based copy with dynamic TS
      out[k] = input[k];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AgentDefinitionService {
  constructor(private readonly db: DbClient) {}

  /**
   * POST /api/v1/agent-definitions — initial creation = v1 + inaugural snapshot.
   * Runs in a single transaction: the `agents` row and its first
   * `agent_definition_versions` row must be written atomically, otherwise a
   * crash mid-way would leave an agent without history.
   */
  async create(input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    return this.db.transaction(async (tx) => {
      const insertValues: typeof agents.$inferInsert = {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        providerType: input.providerType,
        model: input.model ?? null,
        systemPrompt: input.systemPrompt ?? null,
        appendSystemPrompt: input.appendSystemPrompt ?? null,
        allowedTools: input.allowedTools,
        skills: input.skills,
        mcpServers: input.mcpServers,
        maxSteps: input.maxSteps,
        deliveryMode: input.deliveryMode,
        config: (input.config ?? null) as unknown as typeof agents.$inferInsert.config,
        createdBy: input.createdBy ?? null,
        currentVersion: 1,
      };
      const [row] = await tx.insert(agents).values(insertValues).returning();
      if (!row) throw new Error('failed to insert agent row');

      await tx.insert(agentDefinitionVersions).values({
        agentId: row.id,
        version: 1,
        snapshot: extractEditable(row) as unknown as Record<string, unknown>,
        changeNote: input.changeNote ?? null,
        createdBy: input.createdBy ?? null,
      });

      return rowToDefinition(row);
    });
  }

  /**
   * GET /api/v1/agent-definitions/:id — returns the current row, = latest
   * version. Archived rows are included (archived is a state, not a delete).
   */
  async get(agentId: string): Promise<AgentDefinition> {
    const [row] = await this.db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!row) throw new AgentDefinitionNotFoundError(agentId);
    return rowToDefinition(row);
  }

  /**
   * GET /api/v1/agent-definitions/:id?version=N — returns the historical
   * snapshot merged with the owning agent row's immutable metadata.
   */
  async getByVersion(agentId: string, version: number): Promise<AgentDefinition> {
    if (!Number.isInteger(version) || version < 1) {
      throw new InvalidAgentDefinitionInputError('version', version, 'must be a positive integer');
    }
    const [row] = await this.db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!row) throw new AgentDefinitionNotFoundError(agentId);
    const [versionRow] = await this.db
      .select()
      .from(agentDefinitionVersions)
      .where(
        and(
          eq(agentDefinitionVersions.agentId, agentId),
          eq(agentDefinitionVersions.version, version)
        )
      )
      .limit(1);
    if (!versionRow) throw new AgentDefinitionVersionNotFoundError(agentId, version);
    return snapshotToDefinition(row, versionRow);
  }

  /**
   * GET /api/v1/agent-definitions/:id/versions — descending version list,
   * lightweight (no snapshot payload). Cursor-paginated by version number.
   */
  async listVersions(agentId: string, opts: ListVersionsOptions = {}): Promise<ListVersionsResult> {
    const limit = clampLimit(opts.limit);
    const [agentExists] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agentExists) throw new AgentDefinitionNotFoundError(agentId);

    const filters = [eq(agentDefinitionVersions.agentId, agentId)];
    if (typeof opts.cursorVersion === 'number') {
      filters.push(lt(agentDefinitionVersions.version, opts.cursorVersion));
    }

    // Fetch one extra to detect whether another page exists.
    const rows = await this.db
      .select()
      .from(agentDefinitionVersions)
      .where(and(...filters))
      .orderBy(desc(agentDefinitionVersions.version))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(versionRowToSummary);
    const nextCursor = hasMore ? items[items.length - 1].version : null;
    return { items, nextCursor };
  }

  /**
   * PATCH /api/v1/agent-definitions/:id with If-Match: <N>.
   *
   * Implements spec §PATCH 流程 atomically:
   *
   *   1. Load current row (row-lock via `FOR UPDATE`).
   *   2. Reject if archived.
   *   3. Compare ifMatchVersion vs row.currentVersion → 409 on mismatch.
   *   4. Merge current editable fields with the partial body.
   *   5. Insert new `agent_definition_versions` row (version = current+1,
   *      snapshot = merged editable).
   *   6. Update `agents` with new fields + current_version = current+1.
   *
   * An empty patch (no non-changeNote keys) is rejected eagerly before the
   * transaction to keep the semantics in sync with the Zod refine in
   * `patchAgentDefinitionRequestSchema`.
   */
  async patch(agentId: string, input: PatchAgentDefinitionInput): Promise<AgentDefinition> {
    if (!Number.isInteger(input.ifMatchVersion) || input.ifMatchVersion < 1) {
      throw new InvalidAgentDefinitionInputError(
        'ifMatchVersion',
        input.ifMatchVersion,
        'must be a positive integer'
      );
    }
    const editablePatch = pickEditablePatch(input);
    if (Object.keys(editablePatch).length === 0) {
      throw new EmptyAgentDefinitionPatchError();
    }

    return this.db.transaction(async (tx) => {
      // Acquire row lock so concurrent PATCHers serialise, preserving the
      // invariant that `agent_definition_versions.version` is monotonic.
      const [row] = await tx
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .for('update')
        .limit(1);
      if (!row) throw new AgentDefinitionNotFoundError(agentId);
      if (row.archivedAt) {
        throw new AgentDefinitionArchivedError(agentId, row.archivedAt);
      }
      if (row.currentVersion !== input.ifMatchVersion) {
        throw new AgentDefinitionVersionConflictError(
          agentId,
          input.ifMatchVersion,
          row.currentVersion
        );
      }

      const nextVersion = row.currentVersion + 1;
      const merged: AgentDefinitionEditable = {
        ...extractEditable(row),
        ...editablePatch,
      };

      await tx.insert(agentDefinitionVersions).values({
        agentId,
        version: nextVersion,
        snapshot: merged as unknown as Record<string, unknown>,
        changeNote: input.changeNote ?? null,
        createdBy: input.updatedBy ?? null,
      });

      const now = new Date();
      const updateValues: Partial<typeof agents.$inferInsert> = {
        ...editablePatch,
        config:
          'config' in editablePatch
            ? ((editablePatch.config ?? null) as unknown as typeof agents.$inferInsert.config)
            : undefined,
        currentVersion: nextVersion,
        updatedAt: now,
      };
      // Strip undefined keys so drizzle doesn't overwrite columns with NULL.
      for (const k of Object.keys(updateValues) as (keyof typeof updateValues)[]) {
        if (updateValues[k] === undefined) delete updateValues[k];
      }

      const [updated] = await tx
        .update(agents)
        .set(updateValues)
        .where(eq(agents.id, agentId))
        .returning();
      if (!updated) throw new AgentDefinitionNotFoundError(agentId);
      return rowToDefinition(updated);
    });
  }

  /**
   * POST /api/v1/agent-definitions/:id/archive — sets `archived_at = now()`.
   * Idempotent: archiving an already-archived row returns the existing record
   * without bumping a version (archival is metadata, not a definition change).
   */
  async archive(agentId: string): Promise<AgentDefinition> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .for('update')
        .limit(1);
      if (!row) throw new AgentDefinitionNotFoundError(agentId);
      if (row.archivedAt) return rowToDefinition(row);
      const [updated] = await tx
        .update(agents)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(agents.id, agentId))
        .returning();
      if (!updated) throw new AgentDefinitionNotFoundError(agentId);
      return rowToDefinition(updated);
    });
  }
}

function clampLimit(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return 50;
  return Math.min(Math.floor(raw), 200);
}
