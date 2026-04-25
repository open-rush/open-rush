/**
 * Shared helpers for `/api/v1/agents/*` route files.
 *
 * Naming note (repeating the convention from contracts/v1/agents.ts): the
 * *API-layer* "Agent" corresponds to the database table `tasks`. The
 * `agents` DB table stores AgentDefinitions (version metadata + current
 * snapshot). See `specs/managed-agents-api.md §数据模型`.
 *
 * - {@link taskRowToV1Agent} converts a combined `(task row, definition)`
 *   tuple into the v1 wire shape expected by `agentSchema.parse`.
 * - {@link mapRunErrorForAgentDelete} translates RunService errors
 *   surfaced from the DELETE flow into a v1 error Response. Callers use
 *   the classic `catch + map` pattern; `null` means "not a known error,
 *   rethrow to 500".
 * - {@link encodeListCursor} / {@link decodeListCursor} handle the opaque
 *   base64url cursor used by GET /api/v1/agents (mirrors the
 *   AgentDefinitionService pattern).
 */

import type { v1 } from '@open-rush/contracts';
import {
  RunAlreadyTerminalError,
  RunCannotCancelError,
  RunNotFoundError,
} from '@open-rush/control-plane';

import { v1Error } from '@/lib/api/v1-responses';

/** Subset of the DB `tasks` row the API exposes. */
export interface TaskLike {
  id: string;
  projectId: string;
  agentId: string | null;
  createdBy: string | null;
  title: string | null;
  status: string;
  headRunId: string | null;
  activeRunId: string | null;
  definitionVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Subset of the AgentDefinition we need to render `mode`. */
export interface DefinitionLike {
  id: string;
  deliveryMode: string;
  currentVersion: number;
}

/**
 * Convert a `(task row, definition)` pair into the v1 `agentSchema` shape.
 *
 * - `definitionId` = `task.agentId` (the DB-level "agent_id" column points
 *   at the AgentDefinition row).
 * - `definitionVersion` falls back to the definition's `currentVersion` if
 *   the task row has a null version. That keeps legacy rows renderable
 *   while new rows (post-task-11) always carry an explicit version.
 * - `mode` is derived from the definition's `deliveryMode`. The contract
 *   enum (AgentDeliveryMode) narrows this to `'chat' | 'workspace'`; the
 *   cast reflects the design decision locked by the task-4 Sparring
 *   review.
 * - `status` is narrowed to the v1 `AgentStatus` enum (`active` /
 *   `completed` / `cancelled`). Any other persisted string is normalised
 *   to `'active'` defensively — we refuse to fail-open to an unknown
 *   API-layer status that clients cannot exhaustively switch on.
 */
export function taskRowToV1Agent(task: TaskLike, definition: DefinitionLike): v1.Agent {
  const definitionVersion = task.definitionVersion ?? definition.currentVersion;
  const status = normaliseStatus(task.status);
  return {
    id: task.id,
    projectId: task.projectId,
    definitionId: definition.id,
    definitionVersion,
    mode: definition.deliveryMode as v1.Agent['mode'],
    status,
    title: task.title,
    headRunId: task.headRunId,
    activeRunId: task.activeRunId,
    createdBy: task.createdBy,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function normaliseStatus(raw: string): v1.AgentStatus {
  if (raw === 'completed' || raw === 'cancelled' || raw === 'active') return raw;
  // Unknown persisted statuses (historical / P2 additions) collapse to
  // `active` at the API boundary so the Zod response schema stays green.
  return 'active';
}

/**
 * Opaque cursor for `GET /api/v1/agents`. Identical shape to the
 * AgentDefinitionService cursor so the two paginators behave the same at
 * the client: `base64url("<createdAtISO>|<id>")`.
 *
 * Malformed cursors decode to `null` and the handler silently treats that
 * as "first page" — matching the AgentDefinition side's ergonomics.
 */
export function encodeListCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeListCursor(
  cursor: string | undefined
): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep < 0) return null;
    const iso = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Map a RunService cancellation error emitted during `DELETE /api/v1/agents/:id`
 * into a v1 Response. Returns `null` for unknown errors so the route
 * handler rethrows and produces a 500.
 *
 * Semantics for DELETE (`specs/managed-agents-api.md §E2E 3.5`):
 *
 * - {@link RunAlreadyTerminalError} — the active run is already terminal.
 *   The *caller's* DELETE request still succeeds: the Agent is soft-
 *   cancelled, but we surface no cancelled runId. We return `null` here
 *   so the handler treats the transition as idempotent.
 * - {@link RunCannotCancelError} — run is in `finalizing_retryable_failed`,
 *   where no legal `→ failed` edge exists. DELETE is blocked with
 *   `VALIDATION_ERROR` (400) + a retry hint. We don't use 409 here
 *   because the v1 ErrorCode enum reserves 409 for version/idempotency
 *   conflicts; this is a "transient state, try again" condition that
 *   the caller resolves by waiting for the retry/timeout flow.
 * - {@link RunNotFoundError} — shouldn't happen if `task.active_run_id`
 *   was present (FK enforces it), but if the row was concurrently
 *   deleted we soft-degrade to "no active run cancelled" like the
 *   terminal case.
 */
export function mapRunErrorForAgentDelete(err: unknown): Response | 'soft-degrade' | null {
  if (err instanceof RunAlreadyTerminalError) return 'soft-degrade';
  if (err instanceof RunNotFoundError) return 'soft-degrade';
  if (err instanceof RunCannotCancelError) {
    return v1Error(
      'VALIDATION_ERROR',
      `Agent cannot be cancelled while its active run is in '${err.status}'`,
      { hint: 'wait for the retry / timeout flow to resolve and retry DELETE' }
    );
  }
  return null;
}
