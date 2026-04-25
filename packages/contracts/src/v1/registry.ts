/**
 * /api/v1/skills + /api/v1/mcps — Registry read-only contracts.
 *
 * Endpoints (2):
 * - GET /api/v1/skills
 * - GET /api/v1/mcps
 *
 * Only READ surface is exposed on /api/v1/* — install/star/members stay
 * in /api/* (UI-private) per specs/managed-agents-api.md §与 Web UI 关系.
 */
import { z } from 'zod';
import { paginatedResponseSchema, paginationQuerySchema } from './common.js';

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export const SkillVisibility = z.enum(['public', 'private']);
export type SkillVisibility = z.infer<typeof SkillVisibility>;

export const skillSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  sourceType: z.enum(['registry', 'inline']),
  sourceUrl: z.string().url().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  visibility: SkillVisibility,
  latestVersion: z.string().nullable(),
  starCount: z.number().int().min(0),
  installCount: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Skill = z.infer<typeof skillSchema>;

export const listSkillsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  visibility: SkillVisibility.optional(),
});
export type ListSkillsQuery = z.infer<typeof listSkillsQuerySchema>;

export const listSkillsResponseSchema = paginatedResponseSchema(skillSchema);
export type ListSkillsResponse = z.infer<typeof listSkillsResponseSchema>;

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export const McpTransport = z.enum(['stdio', 'http', 'sse']);
export type McpTransport = z.infer<typeof McpTransport>;

export const mcpRegistryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  transportType: McpTransport,
  tools: z.array(z.unknown()),
  tags: z.array(z.string()),
  category: z.string().nullable(),
  author: z.string().nullable(),
  docUrl: z.string().url().nullable(),
  repoUrl: z.string().url().nullable(),
  starCount: z.number().int().min(0),
  isBuiltin: z.boolean(),
  visibility: z.enum(['public', 'private']),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type McpRegistryEntry = z.infer<typeof mcpRegistryEntrySchema>;

export const listMcpsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
  transportType: McpTransport.optional(),
});
export type ListMcpsQuery = z.infer<typeof listMcpsQuerySchema>;

export const listMcpsResponseSchema = paginatedResponseSchema(mcpRegistryEntrySchema);
export type ListMcpsResponse = z.infer<typeof listMcpsResponseSchema>;
