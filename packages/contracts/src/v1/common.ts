/**
 * Shared v1 contracts: error envelope, pagination, success envelope, scope enum.
 *
 * See:
 * - specs/managed-agents-api.md §请求/响应格式, §错误码, §分页
 * - specs/service-token-auth.md §Scope 定义
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Error codes (all 8, per specs/managed-agents-api.md §错误码)
// ---------------------------------------------------------------------------

export const ErrorCode = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** HTTP status codes paired with each error code (non-enum companion). */
export const ERROR_CODE_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const errorBodySchema = z.object({
  code: ErrorCode,
  message: z.string().min(1),
  hint: z.string().optional(),
  /** Optional per-field validation issues (used by VALIDATION_ERROR). */
  issues: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      })
    )
    .optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const errorResponseSchema = z.object({
  error: errorBodySchema,
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---------------------------------------------------------------------------
// Success envelope (generic, per spec)
// ---------------------------------------------------------------------------

/**
 * Build a success envelope schema for a given data shape.
 * Example: `successResponseSchema(userSchema)` → `z.object({ data: userSchema })`.
 */
export function successResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data });
}

// ---------------------------------------------------------------------------
// Pagination (per spec §分页)
// ---------------------------------------------------------------------------

export const paginationQuerySchema = z.object({
  /** 1..200, default 50. Opaque cursor can be used to resume. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Build a paginated response envelope: `{ data: T[]; nextCursor: string | null }`.
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

// ---------------------------------------------------------------------------
// Scopes (per specs/service-token-auth.md §Scope 定义)
// ---------------------------------------------------------------------------

/**
 * Scopes allowed for Service Tokens.
 *
 * Service Tokens MUST use one of these exact values. The `'*'` wildcard is
 * intentionally NOT in this enum — only NextAuth sessions get `'*'`; the
 * Service Token POST endpoint rejects `'*'` in the scopes array with 400.
 */
export const ServiceTokenScope = z.enum([
  'agent-definitions:read',
  'agent-definitions:write',
  'agents:read',
  'agents:write',
  'runs:read',
  'runs:write',
  'runs:cancel',
  'vaults:read',
  'vaults:write',
  'projects:read',
  'projects:write',
]);
export type ServiceTokenScope = z.infer<typeof ServiceTokenScope>;

/**
 * Runtime scope value as carried by AuthContext.
 *
 * Session auth gets `['*']`; Service Token auth gets an explicit subset of
 * {@link ServiceTokenScope}. `authScopeSchema` is the union used by the
 * middleware's own internal contract.
 */
export const AuthScope = z.union([ServiceTokenScope, z.literal('*')]);
export type AuthScope = z.infer<typeof AuthScope>;
