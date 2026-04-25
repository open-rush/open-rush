/**
 * /api/v1/agents/:id/runs — Run CRUD + SSE event stream contracts.
 *
 * Endpoints (5):
 * - POST   /api/v1/agents/:id/runs                       (Idempotency-Key header)
 * - GET    /api/v1/agents/:id/runs
 * - GET    /api/v1/agents/:id/runs/:runId
 * - GET    /api/v1/agents/:id/runs/:runId/events         (SSE, Last-Event-ID)
 * - POST   /api/v1/agents/:id/runs/:runId/cancel
 *
 * See:
 * - specs/managed-agents-api.md §幂等性, §事件协议
 * - specs/agent-definition-versioning.md §runs 表
 */
import { z } from 'zod';
import { ConnectionMode, RunStatus, TriggerSource } from '../enums.js';
import { paginatedResponseSchema, paginationQuerySchema, successResponseSchema } from './common.js';

// ---------------------------------------------------------------------------
// Run entity
// ---------------------------------------------------------------------------

export const runSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  parentRunId: z.string().uuid().nullable(),
  status: RunStatus,
  prompt: z.string(),
  provider: z.string(),
  connectionMode: ConnectionMode,
  modelId: z.string().nullable(),
  triggerSource: TriggerSource,
  /** AgentDefinition version snapshot this run is bound to. */
  agentDefinitionVersion: z.number().int().positive().nullable(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Run = z.infer<typeof runSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/agents/:id/runs
// ---------------------------------------------------------------------------

/**
 * Append a message / kick off a run.
 *
 * `Idempotency-Key` header is OPTIONAL (see spec §幂等性):
 * - Client-generated UUIDv4 recommended.
 * - 24h window: same key + same body hash → return original run.
 *   Same key + different body hash → 409 IDEMPOTENCY_CONFLICT.
 *   Different key → new run.
 * - Body hash computation lives in RunService (task-11, "canonical JSON").
 *   Keep the storage column types aligned with the 0011 migration:
 *   `varchar(255)` for the key, `varchar(64)` for the SHA-256 hex.
 */
export const createRunRequestSchema = z.object({
  input: z.string().min(1),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().url().optional(),
        mimeType: z.string().optional(),
      })
    )
    .optional(),
  parentRunId: z.string().uuid().optional(),
  modelId: z.string().optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

/**
 * Shape of the `Idempotency-Key` header value as accepted by the API.
 * Allows UUID or any ≤255 char ASCII token; the DB column is varchar(255).
 */
export const idempotencyKeyHeaderSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be URL-safe ASCII (A-Z a-z 0-9 _ -)');
export type IdempotencyKeyHeader = z.infer<typeof idempotencyKeyHeaderSchema>;

export const createRunResponseSchema = successResponseSchema(runSchema);
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:id/runs
// ---------------------------------------------------------------------------

export const listRunsQuerySchema = paginationQuerySchema.extend({
  status: RunStatus.optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const listRunsResponseSchema = paginatedResponseSchema(runSchema);
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:id/runs/:runId
// ---------------------------------------------------------------------------

export const getRunParamsSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
});
export type GetRunParams = z.infer<typeof getRunParamsSchema>;

export const getRunResponseSchema = successResponseSchema(runSchema);
export type GetRunResponse = z.infer<typeof getRunResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/agents/:id/runs/:runId/cancel
// ---------------------------------------------------------------------------

/**
 * Cancel is an explicit state transition. The service layer will move the
 * run to `failed` with an appropriate error code or to a dedicated
 * cancelled subtype in P2; v0.1 returns the run in its post-transition shape.
 */
export const cancelRunResponseSchema = successResponseSchema(runSchema);
export type CancelRunResponse = z.infer<typeof cancelRunResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:id/runs/:runId/events  (SSE)
// ---------------------------------------------------------------------------

/**
 * Last-Event-ID header: integer ≥ 0 (the client's last seen `seq`).
 * Used by the server to `SELECT * FROM run_events WHERE seq > N` and then
 * attach to the live stream. No query-string cursor is supported (single
 * protocol — see spec §断线重连).
 */
export const lastEventIdHeaderSchema = z.coerce.number().int().min(0);
export type LastEventIdHeader = z.infer<typeof lastEventIdHeaderSchema>;

// ---------------------------------------------------------------------------
// Event payload (AI SDK UIMessageChunk + Open-rush data-openrush-* extensions)
// ---------------------------------------------------------------------------

/**
 * Event stream payload shape.
 *
 * IMPORTANT: We align with AI SDK **UIMessageChunk** (the on-wire streaming
 * format) rather than the higher-level `UIMessagePart` (post-aggregation UI
 * shape). Rationale:
 *
 * 1. `run_events` is filled by the agent-worker → control-worker pipeline
 *    which already emits UIMessageChunk (see
 *    `packages/control-plane/src/conversation/reconstruct-messages.ts`, which
 *    switches on `text-delta`, `tool-input-start`, `tool-input-available`,
 *    `tool-output-available`, `tool-output-error`). Any reinterpretation
 *    would force a runtime rewrite.
 * 2. `packages/contracts/src/enums.ts` already defines `UIMessageChunkType`
 *    and `events.ts` defines the base `UIMessageChunk` shape; we extend that
 *    rather than inventing a parallel hierarchy.
 * 3. AI SDK 6 retired the `text-delta` → `text` collapse that the spec
 *    authors referenced; the canonical chunk types live in
 *    `enums.ts → UIMessageChunkType` and are what the runtime emits.
 *
 * Spec note: `specs/managed-agents-api.md §事件 payload 类型` lists older
 * AI SDK 3 part names (`text-delta`, `step-finish`, `tool state=call|result|error`).
 * The authoritative list is now {@link UIMessageChunkType} in enums.ts.
 * This decision is locked by Sparring review in task-4.
 *
 * We deliberately do NOT import `ai` into `@open-rush/contracts` (pulls
 * React + streams into sdk/agent-worker/control-plane). Consumers that
 * want the narrow compile-time type can add `import type { UIMessageChunk }
 * from 'ai'` at their own site.
 */

/** AI SDK UIMessageChunk — text stream chunks. */
const textStartChunkSchema = z.object({
  type: z.literal('text-start'),
  id: z.string().optional(),
});
const textDeltaChunkSchema = z.object({
  type: z.literal('text-delta'),
  id: z.string().optional(),
  delta: z.string().optional(),
  content: z.string().optional(),
});
const textEndChunkSchema = z.object({
  type: z.literal('text-end'),
  id: z.string().optional(),
});

/** AI SDK UIMessageChunk — reasoning stream chunks. */
const reasoningStartChunkSchema = z.object({
  type: z.literal('reasoning-start'),
  id: z.string().optional(),
});
const reasoningDeltaChunkSchema = z.object({
  type: z.literal('reasoning-delta'),
  id: z.string().optional(),
  delta: z.string().optional(),
  content: z.string().optional(),
});
const reasoningEndChunkSchema = z.object({
  type: z.literal('reasoning-end'),
  id: z.string().optional(),
});

/**
 * AI SDK UIMessageChunk — tool invocation lifecycle.
 *
 * Tool name identification lives in `toolName` (not in the `type` string),
 * matching the reconstruct-messages consumer. `input` / `output` are opaque
 * JSON values; `errorText` carries human-readable error on output error.
 */
const toolInputStartChunkSchema = z.object({
  type: z.literal('tool-input-start'),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
});
const toolInputDeltaChunkSchema = z.object({
  type: z.literal('tool-input-delta'),
  toolCallId: z.string().optional(),
  delta: z.string().optional(),
});
const toolInputAvailableChunkSchema = z.object({
  type: z.literal('tool-input-available'),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  input: z.unknown().optional(),
});
const toolOutputAvailableChunkSchema = z.object({
  type: z.literal('tool-output-available'),
  toolCallId: z.string().optional(),
  output: z.unknown().optional(),
});
const toolOutputErrorChunkSchema = z.object({
  type: z.literal('tool-output-error'),
  toolCallId: z.string().optional(),
  errorText: z.string().optional(),
});

/** AI SDK UIMessageChunk — stream / step lifecycle markers. */
const startChunkSchema = z.object({
  type: z.literal('start'),
  messageId: z.string().optional(),
});
const finishChunkSchema = z.object({
  type: z.literal('finish'),
  reason: z.string().optional(),
});
const errorChunkSchema = z.object({
  type: z.literal('error'),
  errorText: z.string().optional(),
});
const startStepChunkSchema = z.object({ type: z.literal('start-step') });
const finishStepChunkSchema = z.object({
  type: z.literal('finish-step'),
  reason: z.string().optional(),
});

/**
 * Generic data-* chunk. We disallow the `data-openrush-*` subset here
 * because those are covered by the dedicated extension schemas below
 * (well-known payload shapes).
 */
const genericDataChunkSchema = z
  .object({
    type: z.string().regex(/^data-[A-Za-z0-9_-]+$/),
    id: z.string().optional(),
    data: z.unknown(),
  })
  .refine((v) => !v.type.startsWith('data-openrush-'), {
    message: 'use a specific openrushEventPartSchema for data-openrush-* events',
  });

// --- Open-rush extensions (specs/managed-agents-api.md §事件 payload 类型) ---

export const openrushRunStartedPartSchema = z.object({
  type: z.literal('data-openrush-run-started'),
  id: z.string().optional(),
  data: z.object({
    runId: z.string().uuid(),
    agentId: z.string().uuid(),
    /** Snapshot version the worker is executing against. */
    definitionVersion: z.number().int().positive(),
  }),
});
export type OpenrushRunStartedPart = z.infer<typeof openrushRunStartedPartSchema>;

export const openrushRunDonePartSchema = z.object({
  type: z.literal('data-openrush-run-done'),
  id: z.string().optional(),
  data: z.object({
    status: z.enum(['success', 'failed', 'cancelled']),
    error: z.string().optional(),
  }),
});
export type OpenrushRunDonePart = z.infer<typeof openrushRunDonePartSchema>;

export const openrushUsagePartSchema = z.object({
  type: z.literal('data-openrush-usage'),
  id: z.string().optional(),
  data: z.object({
    tokensIn: z.number().int().min(0),
    tokensOut: z.number().int().min(0),
    costUsd: z.number().min(0),
  }),
});
export type OpenrushUsagePart = z.infer<typeof openrushUsagePartSchema>;

export const openrushSubRunPartSchema = z.object({
  type: z.literal('data-openrush-sub-run'),
  id: z.string().optional(),
  data: z.object({
    parentRunId: z.string().uuid(),
    childRunId: z.string().uuid(),
  }),
});
export type OpenrushSubRunPart = z.infer<typeof openrushSubRunPartSchema>;

export const openrushExtensionPartSchema = z.discriminatedUnion('type', [
  openrushRunStartedPartSchema,
  openrushRunDonePartSchema,
  openrushUsagePartSchema,
  openrushSubRunPartSchema,
]);
export type OpenrushExtensionPart = z.infer<typeof openrushExtensionPartSchema>;

/**
 * Full Run event payload: AI SDK UIMessageChunk ∪ Open-rush extensions.
 * This is what lives in `run_events.payload` (JSONB) and what SSE frames
 * emit. See enums.ts → {@link UIMessageChunkType} for the canonical list.
 */
export const runEventPayloadSchema = z.union([
  textStartChunkSchema,
  textDeltaChunkSchema,
  textEndChunkSchema,
  reasoningStartChunkSchema,
  reasoningDeltaChunkSchema,
  reasoningEndChunkSchema,
  toolInputStartChunkSchema,
  toolInputDeltaChunkSchema,
  toolInputAvailableChunkSchema,
  toolOutputAvailableChunkSchema,
  toolOutputErrorChunkSchema,
  startChunkSchema,
  finishChunkSchema,
  errorChunkSchema,
  startStepChunkSchema,
  finishStepChunkSchema,
  openrushExtensionPartSchema,
  genericDataChunkSchema,
]);
export type RunEventPayload = z.infer<typeof runEventPayloadSchema>;

/**
 * SSE frame as emitted on the wire. `id` is the per-run sequence number,
 * re-used by Last-Event-ID on reconnect.
 */
export const runEventSseFrameSchema = z.object({
  id: z.number().int().min(1),
  data: runEventPayloadSchema,
});
export type RunEventSseFrame = z.infer<typeof runEventSseFrameSchema>;
