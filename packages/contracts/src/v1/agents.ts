/**
 * /api/v1/agents — Agent (= database `tasks` row) CRUD contracts.
 *
 * Endpoints (4):
 * - POST   /api/v1/agents
 * - GET    /api/v1/agents
 * - GET    /api/v1/agents/:id
 * - DELETE /api/v1/agents/:id
 *
 * Naming note: API-layer "Agent" = DB table `tasks`. AgentDefinition is
 * stored in `agents` table (historical). Do not confuse.
 */
import { z } from 'zod';
import { AgentDeliveryMode } from '../enums.js';
import { paginatedResponseSchema, paginationQuerySchema, successResponseSchema } from './common.js';

// ---------------------------------------------------------------------------
// Status for API layer (derived from DB `tasks.status` semantics)
// ---------------------------------------------------------------------------

export const AgentStatus = z.enum(['active', 'completed', 'cancelled']);
export type AgentStatus = z.infer<typeof AgentStatus>;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const agentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  definitionId: z.string().uuid(),
  /** Snapshot version the Agent is bound to. */
  definitionVersion: z.number().int().positive(),
  mode: AgentDeliveryMode,
  status: AgentStatus,
  title: z.string().nullable(),
  headRunId: z.string().uuid().nullable(),
  activeRunId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Agent = z.infer<typeof agentSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/agents  (create Agent + (optionally) first Run)
// ---------------------------------------------------------------------------

/**
 * Create a new Agent. If `initialInput` is provided, the service-layer
 * also creates the first Run so the event stream can start immediately.
 *
 * - `definitionVersion` is optional; if omitted, service uses the current
 *   version of the definition and freezes it into `tasks.definition_version`.
 * - `mode` maps to DB `tasks.delivery_mode` (indirect via definition).
 */
export const createAgentRequestSchema = z.object({
  definitionId: z.string().uuid(),
  definitionVersion: z.number().int().positive().optional(),
  projectId: z.string().uuid(),
  mode: AgentDeliveryMode,
  title: z.string().max(200).optional(),
  initialInput: z.string().optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

/**
 * Optionally includes the first run if one was created synchronously.
 */
export const createAgentResponseSchema = successResponseSchema(
  z.object({
    agent: agentSchema,
    firstRunId: z.string().uuid().nullable(),
  })
);
export type CreateAgentResponse = z.infer<typeof createAgentResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agents
// ---------------------------------------------------------------------------

export const listAgentsQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().uuid().optional(),
  status: AgentStatus.optional(),
  definitionId: z.string().uuid().optional(),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const listAgentsResponseSchema = paginatedResponseSchema(agentSchema);
export type ListAgentsResponse = z.infer<typeof listAgentsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:id
// ---------------------------------------------------------------------------

export const getAgentParamsSchema = z.object({
  id: z.string().uuid(),
});
export type GetAgentParams = z.infer<typeof getAgentParamsSchema>;

export const getAgentResponseSchema = successResponseSchema(agentSchema);
export type GetAgentResponse = z.infer<typeof getAgentResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/v1/agents/:id  (soft cancel)
// ---------------------------------------------------------------------------

/**
 * DELETE semantics: status → 'cancelled', any active run is also cancelled.
 * Rows remain for audit.
 */
export const deleteAgentResponseSchema = successResponseSchema(
  z.object({
    id: z.string().uuid(),
    status: z.literal('cancelled'),
    cancelledRunId: z.string().uuid().nullable(),
  })
);
export type DeleteAgentResponse = z.infer<typeof deleteAgentResponseSchema>;
