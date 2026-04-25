/**
 * /api/v1/projects — Project minimal CRUD contracts.
 *
 * Endpoints (3):
 * - POST /api/v1/projects
 * - GET  /api/v1/projects
 * - GET  /api/v1/projects/:id
 */
import { z } from 'zod';
import { ConnectionMode } from '../enums.js';
import { paginatedResponseSchema, paginationQuerySchema, successResponseSchema } from './common.js';

// ---------------------------------------------------------------------------
// Project entity
// ---------------------------------------------------------------------------

export const SandboxProviderId = z.enum(['opensandbox', 'e2b', 'docker', 'custom']);
export type SandboxProviderId = z.infer<typeof SandboxProviderId>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  sandboxProvider: SandboxProviderId,
  defaultModel: z.string().nullable(),
  defaultConnectionMode: ConnectionMode.nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof projectSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/projects
// ---------------------------------------------------------------------------

export const createProjectRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  sandboxProvider: SandboxProviderId.default('opensandbox'),
  defaultModel: z.string().optional(),
  defaultConnectionMode: ConnectionMode.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const createProjectResponseSchema = successResponseSchema(projectSchema);
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/projects
// ---------------------------------------------------------------------------

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const listProjectsResponseSchema = paginatedResponseSchema(projectSchema);
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/projects/:id
// ---------------------------------------------------------------------------

export const getProjectParamsSchema = z.object({
  id: z.string().uuid(),
});
export type GetProjectParams = z.infer<typeof getProjectParamsSchema>;

export const getProjectResponseSchema = successResponseSchema(projectSchema);
export type GetProjectResponse = z.infer<typeof getProjectResponseSchema>;
