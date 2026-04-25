/**
 * /api/v1/agents/:id
 *   - GET    — return a single Agent
 *   - DELETE — soft cancel: transitions task.status → 'cancelled' and, if
 *              present, cancels the active run via RunService.cancelRun.
 *
 * Auth: session OR service-token with scope `agents:read` (GET) /
 *       `agents:write` (DELETE). See specs/service-token-auth.md.
 *
 * Project-membership check runs AFTER loading the task row (we need the
 * owning `projectId` before we can verify). Same rationale as the
 * agent-definitions `[id]` route — callers poking at ids they don't own
 * get 403, not a 404 contrast.
 */

import { v1 } from '@open-rush/contracts';
import { DrizzleRunDb, RunService } from '@open-rush/control-plane';
import { agents as agentsTable, getDbClient, tasks } from '@open-rush/db';
import { eq } from 'drizzle-orm';
import { v1Error, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import {
  type DefinitionLike,
  mapRunErrorForAgentDelete,
  type TaskLike,
  taskRowToV1Agent,
} from '../helpers';

// -----------------------------------------------------------------------------
// GET /api/v1/agents/:id
// -----------------------------------------------------------------------------

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agents:read')) {
    return v1Error('FORBIDDEN', 'Missing scope agents:read');
  }

  const { id } = await params;
  const paramsParsed = v1.getAgentParamsSchema.safeParse({ id });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const db = getDbClient();
  const taskRow = await loadTaskById(db, paramsParsed.data.id);
  if (!taskRow) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);

  if (!(await verifyProjectAccess(taskRow.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  const def = await loadDefinition(db, taskRow.agentId);
  if (!def) {
    // Task references a deleted/missing AgentDefinition. Render 404 at
    // the API boundary so clients don't see a partially-valid entity.
    return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} has no backing AgentDefinition`);
  }

  return v1Success(taskRowToV1Agent(taskRow, def));
}

// -----------------------------------------------------------------------------
// DELETE /api/v1/agents/:id  (soft cancel)
// -----------------------------------------------------------------------------

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agents:write')) {
    return v1Error('FORBIDDEN', 'Missing scope agents:write');
  }

  const { id } = await params;
  const paramsParsed = v1.getAgentParamsSchema.safeParse({ id });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const db = getDbClient();
  const taskRow = await loadTaskById(db, paramsParsed.data.id);
  if (!taskRow) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);

  if (!(await verifyProjectAccess(taskRow.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  // Idempotent DELETE: if the task is already cancelled we short-circuit
  // to the success envelope. We still look up the active run so we can
  // surface a consistent `cancelledRunId` — but we don't re-cancel.
  const alreadyCancelled = taskRow.status === 'cancelled';

  let cancelledRunId: string | null = null;
  if (!alreadyCancelled && taskRow.activeRunId) {
    const runService = new RunService(new DrizzleRunDb(db));
    try {
      const cancelled = await runService.cancelRun(taskRow.activeRunId);
      cancelledRunId = cancelled.id;
    } catch (err) {
      const mapped = mapRunErrorForAgentDelete(err);
      if (mapped === 'soft-degrade') {
        // Active run is already terminal or the row disappeared — the
        // Agent-level cancel should still succeed without reporting a
        // cancelledRunId (the callers are DELETE-idempotent).
        cancelledRunId = null;
      } else if (mapped) {
        return mapped;
      } else {
        throw err;
      }
    }
  }

  // Write the task transition. We accept the "already cancelled" branch
  // as a no-op so retries stay idempotent. `updatedAt` is always bumped
  // so callers can see "something happened" on the audit trail.
  if (!alreadyCancelled) {
    await db
      .update(tasks)
      .set({
        status: 'cancelled',
        activeRunId: null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskRow.id));
  }

  const body: v1.DeleteAgentResponse = {
    data: {
      id: taskRow.id,
      status: 'cancelled',
      cancelledRunId,
    },
  };
  return v1Success(body.data);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function loadTaskById(
  db: ReturnType<typeof getDbClient>,
  id: string
): Promise<TaskLike | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return (row as TaskLike | undefined) ?? null;
}

async function loadDefinition(
  db: ReturnType<typeof getDbClient>,
  agentId: string | null
): Promise<DefinitionLike | null> {
  if (!agentId) return null;
  const [row] = await db
    .select({
      id: agentsTable.id,
      deliveryMode: agentsTable.deliveryMode,
      currentVersion: agentsTable.currentVersion,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  return row ?? null;
}
