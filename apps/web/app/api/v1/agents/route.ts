/**
 * /api/v1/agents
 *  - POST — create an Agent (DB `tasks` row) + optionally the first Run
 *  - GET  — cursor-paginated list, optionally filtered by `projectId`,
 *           `status`, `definitionId`.
 *
 * Auth: session OR service-token with scope `agents:write` (POST) /
 *       `agents:read` (GET). See specs/service-token-auth.md.
 *
 * Project access: POST requires membership of `body.projectId`. GET scopes
 * the response to the caller's accessible projects (same pattern as the
 * agent-definitions GET).
 *
 * Vocabulary reminder: the API-layer *Agent* is persisted as a row in the
 * DB `tasks` table; the backing `AgentDefinition` lives in the DB `agents`
 * table. `definitionId` in the wire contract = `tasks.agent_id`.
 */

import { v1 } from '@open-rush/contracts';
import {
  AgentDefinitionNotFoundError,
  AgentDefinitionService,
  AgentDefinitionVersionNotFoundError,
  DrizzleRunDb,
  RunService,
} from '@open-rush/control-plane';
import { agents as agentsTable, getDbClient, projectMembers, projects, tasks } from '@open-rush/db';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { v1Error, v1Paginated, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import {
  type DefinitionLike,
  decodeListCursor,
  encodeListCursor,
  type TaskLike,
  taskRowToV1Agent,
} from './helpers';

// -----------------------------------------------------------------------------
// POST /api/v1/agents
// -----------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agents:write')) {
    return v1Error('FORBIDDEN', 'Missing scope agents:write');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return v1Error('VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = v1.createAgentRequestSchema.safeParse(body);
  if (!parsed.success) return v1ValidationError(parsed.error);

  const input = parsed.data;

  if (!(await verifyProjectAccess(input.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  const db = getDbClient();
  const defService = new AgentDefinitionService(db);

  // Resolve (+validate) the AgentDefinition snapshot we're binding to.
  let definition: Awaited<ReturnType<typeof defService.get>>;
  try {
    definition = input.definitionVersion
      ? await defService.getByVersion(input.definitionId, input.definitionVersion)
      : await defService.get(input.definitionId);
  } catch (err) {
    if (err instanceof AgentDefinitionNotFoundError) {
      return v1Error('NOT_FOUND', `AgentDefinition ${err.agentId} not found`);
    }
    if (err instanceof AgentDefinitionVersionNotFoundError) {
      return v1Error(
        'NOT_FOUND',
        `AgentDefinition ${err.agentId} version ${err.version} not found`
      );
    }
    throw err;
  }

  // AgentDefinition must live in the same project as the new Agent. This
  // closes the "ask a stranger's definition to be mounted in my project"
  // loophole — the scope check above only covers the target project, not
  // the definition's origin project.
  if (definition.projectId !== input.projectId) {
    return v1Error('VALIDATION_ERROR', 'AgentDefinition does not belong to this project');
  }

  // NOTE: archived definitions are still allowed to back new Agents. This
  // tracks `specs/agent-definition-versioning.md §归档`:
  //   "归档后仍可创建 Agent(兼容历史需求),但会有 warning(未来可改为禁止)"
  // We surface a soft warning via the log, but the request proceeds.
  // PATCH on the definition is still blocked by AgentDefinitionService
  // (task-7); that's the binding guardrail against schema drift, not this
  // route.
  if (definition.archivedAt) {
    // Intentionally a log-only breadcrumb so ops can track the deprecation
    // path. Keep it at warn so production log aggregators surface it.
    console.warn(
      `[api/v1/agents] creating Agent against archived definition ${definition.id} (archived_at=${definition.archivedAt.toISOString()})`
    );
  }

  // Bound version = explicit override (validated via getByVersion) else
  // the definition's current version. The frozen value lands in
  // `tasks.definition_version` so future runs inherit from here.
  const boundVersion = input.definitionVersion ?? definition.currentVersion;

  // Spec: `mode: "chat" | "workspace"` must match the definition's delivery
  // mode; this is a design guardrail (a definition is either a chat agent
  // or a workspace agent, not both). A mismatch is a 400 — the frontend
  // can switch modes by picking a different definition.
  if (input.mode !== definition.deliveryMode) {
    return v1Error(
      'VALIDATION_ERROR',
      `mode '${input.mode}' does not match AgentDefinition deliveryMode '${definition.deliveryMode}'`,
      { hint: 'pick the matching definition, or re-create it with a different deliveryMode' }
    );
  }

  // Wrap the task insert + (optional) first-run insert + back-link UPDATE
  // in a single transaction. This fails closed — if the run insert throws
  // we won't leave behind a half-made task row with a dangling
  // `activeRunId=null` that the caller can't easily retry with
  // idempotency. Note: plain `createRun` (NOT createRunWithIdempotency)
  // doesn't take an advisory lock, so the tx boundary is just a row-
  // level guard on (tasks INSERT → runs INSERT → tasks UPDATE).
  const { task: finalTask, firstRunId } = await db.transaction(async (tx) => {
    const [taskRow] = await tx
      .insert(tasks)
      .values({
        projectId: input.projectId,
        createdBy: auth.userId,
        agentId: input.definitionId,
        title: input.title ?? null,
        status: 'active',
        definitionVersion: boundVersion,
      })
      .returning();
    if (!taskRow) {
      // Drizzle returns the inserted row unless the INSERT was filtered
      // out at the DB level. Bail so the tx rolls back.
      throw new Error('failed to insert tasks row');
    }

    // If `initialInput` is provided, kick off the first Run synchronously so
    // the event stream can start immediately. No Idempotency-Key is honoured
    // on this path — the agent-creation endpoint isn't guaranteed idempotent
    // (spec §幂等性: only POST /runs supports it). Clients that need
    // idempotent first-run creation should POST the agent, then POST /runs.
    if (!input.initialInput || input.initialInput.length === 0) {
      return { task: taskRow, firstRunId: null as string | null };
    }

    // Cast: `tx` is a `PgTransaction` whose runtime shape is the subset
    // of `DbClient` that DrizzleRunDb needs (select / insert / update /
    // transaction). The drizzle types don't expose this equivalence, so
    // we narrow to `unknown` first and then to `DbClient`. Identical
    // pattern to how AgentDefinitionService runs its nested inserts on
    // tx.
    const runService = new RunService(new DrizzleRunDb(tx as unknown as typeof db));
    const run = await runService.createRun({
      agentId: input.definitionId,
      prompt: input.initialInput,
      taskId: taskRow.id,
      agentDefinitionVersion: boundVersion,
      triggerSource: 'user',
    });

    const [updated] = await tx
      .update(tasks)
      .set({
        activeRunId: run.id,
        headRunId: run.id,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskRow.id))
      .returning();
    if (!updated) {
      throw new Error('failed to attach first run to tasks row');
    }

    return { task: updated, firstRunId: run.id as string | null };
  });

  const body201: v1.CreateAgentResponse = {
    data: {
      agent: taskRowToV1Agent(finalTask as TaskLike, definitionLike(definition)),
      firstRunId,
    },
  };
  return Response.json(body201, { status: 201 });
}

// -----------------------------------------------------------------------------
// GET /api/v1/agents
// -----------------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agents:read')) {
    return v1Error('FORBIDDEN', 'Missing scope agents:read');
  }

  const url = new URL(request.url);
  const parsed = v1.listAgentsQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    definitionId: url.searchParams.get('definitionId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) return v1ValidationError(parsed.error);

  const db = getDbClient();

  let scope: { projectId?: string; projectIds?: string[] };
  if (parsed.data.projectId) {
    if (!(await verifyProjectAccess(parsed.data.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
    scope = { projectId: parsed.data.projectId };
  } else {
    scope = { projectIds: await listAccessibleProjectIds(db, auth.userId) };
    if (scope.projectIds && scope.projectIds.length === 0) {
      // No accessible projects → empty result. Short-circuit so we don't
      // issue a degenerate `IN ()` which some dialects reject.
      return v1Paginated<v1.Agent>([], null);
    }
  }

  const limit = parsed.data.limit;
  const cursor = decodeListCursor(parsed.data.cursor);

  const filters = [];
  if (scope.projectId) filters.push(eq(tasks.projectId, scope.projectId));
  if (scope.projectIds) filters.push(inArray(tasks.projectId, scope.projectIds));
  if (parsed.data.status) filters.push(eq(tasks.status, parsed.data.status));
  if (parsed.data.definitionId) filters.push(eq(tasks.agentId, parsed.data.definitionId));
  if (cursor) {
    // Keyset pagination mirrors the AgentDefinitionService cursor: truncate
    // to ms precision on both sides so microsecond-different rows in the
    // same ms bucket don't slip past the boundary.
    filters.push(
      or(
        sql`date_trunc('milliseconds', ${tasks.createdAt}) < ${cursor.createdAt}`,
        and(
          sql`date_trunc('milliseconds', ${tasks.createdAt}) = ${cursor.createdAt}`,
          lt(tasks.id, cursor.id)
        )
      ) as never
    );
  }

  const where = filters.length === 0 ? undefined : and(...filters);

  const rows = await db
    .select()
    .from(tasks)
    .where(where as never)
    .orderBy(sql`date_trunc('milliseconds', ${tasks.createdAt}) DESC`, desc(tasks.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  // Batch-fetch the owning AgentDefinitions so each task row can render
  // `definitionId` + `mode`. One query, O(page) rows. Empty page ⇒ skip.
  const definitionIds = Array.from(
    new Set(page.map((r) => r.agentId).filter((x): x is string => !!x))
  );
  const defs = definitionIds.length
    ? await db
        .select({
          id: agentsTable.id,
          deliveryMode: agentsTable.deliveryMode,
          currentVersion: agentsTable.currentVersion,
        })
        .from(agentsTable)
        .where(inArray(agentsTable.id, definitionIds))
    : [];
  const defById = new Map<string, DefinitionLike>(defs.map((d) => [d.id, d]));

  const items: v1.Agent[] = [];
  for (const row of page) {
    const def = row.agentId ? defById.get(row.agentId) : undefined;
    if (!def) {
      // Row has no backing AgentDefinition (should be rare — FK is
      // `onDelete: set null`). Skip so the wire shape stays valid.
      continue;
    }
    items.push(taskRowToV1Agent(row as TaskLike, def));
  }

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeListCursor(last.createdAt, last.id) : null;
  return v1Paginated(items, nextCursor);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Union of memberships + creator-fallback, excluding soft-deleted projects.
 * Mirrors the identical helper in the agent-definitions route so both
 * endpoints behave the same for callers without explicit `projectId`.
 */
async function listAccessibleProjectIds(
  db: ReturnType<typeof getDbClient>,
  userId: string
): Promise<string[]> {
  const [memberships, created] = await Promise.all([
    db
      .select({ projectId: projects.id })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt))),
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.createdBy, userId), isNull(projects.deletedAt))),
  ]);
  const ids = new Set<string>();
  for (const m of memberships) ids.add(m.projectId);
  for (const p of created) ids.add(p.id);
  return Array.from(ids);
}

function definitionLike(d: Awaited<ReturnType<AgentDefinitionService['get']>>): DefinitionLike {
  return { id: d.id, deliveryMode: d.deliveryMode, currentVersion: d.currentVersion };
}
