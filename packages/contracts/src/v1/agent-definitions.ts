/**
 * /api/v1/agent-definitions — AgentDefinition versioned CRUD contracts.
 *
 * Endpoints (6):
 * - POST   /api/v1/agent-definitions
 * - GET    /api/v1/agent-definitions
 * - GET    /api/v1/agent-definitions/:id          (?version=N for historical)
 * - PATCH  /api/v1/agent-definitions/:id          (If-Match header required)
 * - GET    /api/v1/agent-definitions/:id/versions (list history, no snapshot)
 * - POST   /api/v1/agent-definitions/:id/archive
 *
 * See specs/agent-definition-versioning.md §API 语义.
 */
import { z } from 'zod';
import { AgentDeliveryMode } from '../enums.js';
import { paginatedResponseSchema, paginationQuerySchema, successResponseSchema } from './common.js';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/**
 * Editable AgentDefinition fields — the set that a PATCH body may touch.
 * Notably excludes id/projectId (immutable), currentVersion/archivedAt (bookkeeping),
 * and runtime-state columns (activeStreamId, lastActiveAt).
 */
export const agentDefinitionEditableSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  providerType: z.string().min(1).max(50),
  model: z.string().max(255).nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()),
  skills: z.array(z.string()),
  mcpServers: z.array(z.string()),
  maxSteps: z.number().int().min(1).max(1000),
  deliveryMode: AgentDeliveryMode,
  /** Arbitrary provider-specific config blob. */
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AgentDefinitionEditable = z.infer<typeof agentDefinitionEditableSchema>;

/**
 * Full AgentDefinition entity as returned by GET endpoints.
 */
export const agentDefinitionSchema = agentDefinitionEditableSchema.extend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  currentVersion: z.number().int().positive(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/agent-definitions
// ---------------------------------------------------------------------------

export const createAgentDefinitionRequestSchema = agentDefinitionEditableSchema.extend({
  projectId: z.string().uuid(),
  /** Optional change note recorded in the first version row. */
  changeNote: z.string().max(1000).optional(),
});
export type CreateAgentDefinitionRequest = z.infer<typeof createAgentDefinitionRequestSchema>;

export const createAgentDefinitionResponseSchema = successResponseSchema(agentDefinitionSchema);
export type CreateAgentDefinitionResponse = z.infer<typeof createAgentDefinitionResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agent-definitions
// ---------------------------------------------------------------------------

/**
 * Boolean-from-string helper for query params. Does NOT use `z.coerce.boolean`
 * because that falls back to JS `Boolean(value)` semantics — the string
 * `"false"` is truthy there, which would silently flip the filter. We accept
 * the canonical URL-query forms `"true" | "false"` + bare booleans only.
 */
const queryBoolean = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => v === true || v === 'true');

export const listAgentDefinitionsQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().uuid().optional(),
  /** Include archived definitions in results (default false). */
  includeArchived: queryBoolean.default(false),
});
export type ListAgentDefinitionsQuery = z.infer<typeof listAgentDefinitionsQuerySchema>;

export const listAgentDefinitionsResponseSchema = paginatedResponseSchema(agentDefinitionSchema);
export type ListAgentDefinitionsResponse = z.infer<typeof listAgentDefinitionsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agent-definitions/:id  (default: current; ?version=N: historical)
// ---------------------------------------------------------------------------

export const getAgentDefinitionParamsSchema = z.object({
  id: z.string().uuid(),
});
export type GetAgentDefinitionParams = z.infer<typeof getAgentDefinitionParamsSchema>;

export const getAgentDefinitionQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
});
export type GetAgentDefinitionQuery = z.infer<typeof getAgentDefinitionQuerySchema>;

export const getAgentDefinitionResponseSchema = successResponseSchema(agentDefinitionSchema);
export type GetAgentDefinitionResponse = z.infer<typeof getAgentDefinitionResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/v1/agent-definitions/:id   (If-Match header REQUIRED)
// ---------------------------------------------------------------------------

/**
 * The PATCH body is a partial of the editable fields plus an optional
 * change note. Empty body is rejected by the API layer (no-op PATCH).
 *
 * The `If-Match: <current_version>` header is validated by the route
 * handler against `agents.current_version`; mismatch → 409 VERSION_CONFLICT.
 */
export const patchAgentDefinitionRequestSchema = agentDefinitionEditableSchema
  .partial()
  .extend({
    changeNote: z.string().max(1000).optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'changeNote'), {
    message: 'PATCH must modify at least one editable field',
  });
export type PatchAgentDefinitionRequest = z.infer<typeof patchAgentDefinitionRequestSchema>;

/** Number from the `If-Match` header. */
export const ifMatchHeaderSchema = z.coerce.number().int().positive();
export type IfMatchHeader = z.infer<typeof ifMatchHeaderSchema>;

export const patchAgentDefinitionResponseSchema = successResponseSchema(agentDefinitionSchema);
export type PatchAgentDefinitionResponse = z.infer<typeof patchAgentDefinitionResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agent-definitions/:id/versions
// ---------------------------------------------------------------------------

/**
 * Version history row — does NOT contain the full snapshot (payload),
 * to keep the list response lightweight.
 */
export const agentDefinitionVersionSummarySchema = z.object({
  version: z.number().int().positive(),
  changeNote: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type AgentDefinitionVersionSummary = z.infer<typeof agentDefinitionVersionSummarySchema>;

export const listAgentDefinitionVersionsResponseSchema = paginatedResponseSchema(
  agentDefinitionVersionSummarySchema
);
export type ListAgentDefinitionVersionsResponse = z.infer<
  typeof listAgentDefinitionVersionsResponseSchema
>;

// ---------------------------------------------------------------------------
// POST /api/v1/agent-definitions/:id/archive
// ---------------------------------------------------------------------------

export const archiveAgentDefinitionResponseSchema = successResponseSchema(
  z.object({
    id: z.string().uuid(),
    archivedAt: z.string().datetime({ offset: true }),
  })
);
export type ArchiveAgentDefinitionResponse = z.infer<typeof archiveAgentDefinitionResponseSchema>;
