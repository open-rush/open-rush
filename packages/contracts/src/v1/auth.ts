/**
 * /api/v1/auth/tokens — Service Token CRUD contracts.
 *
 * Endpoints:
 * - POST   /api/v1/auth/tokens        (session-only, returns plaintext ONCE)
 * - GET    /api/v1/auth/tokens        (list own tokens, no plaintext)
 * - DELETE /api/v1/auth/tokens/:id    (soft revoke)
 *
 * See specs/service-token-auth.md §颁发流程 §v0.1 护栏 §吊销.
 */
import { z } from 'zod';
import { paginatedResponseSchema, ServiceTokenScope, successResponseSchema } from './common.js';

// ---------------------------------------------------------------------------
// POST /api/v1/auth/tokens
// ---------------------------------------------------------------------------

/** Maximum allowed distance between `now()` and `expiresAt`. */
export const SERVICE_TOKEN_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Service Token creation guardrails (v0.1, per spec §颁发流程 §v0.1 护栏):
 * - `scopes` must NOT contain `'*'` (enforced by `ServiceTokenScope` enum).
 * - `scopes` must be non-empty.
 * - `expiresAt` is REQUIRED, must be ≤ now() + 90 days, and strictly in the
 *   future (rejects expiresAt already in the past).
 * - Per-user active token cap (20) is enforced in the service layer, not here.
 *
 * The TTL cap is enforced here at the schema layer (not just in the service
 * layer) so that consumers — SDK, CLI, other language bindings — see the
 * same error shape (`VALIDATION_ERROR`) consistently, without relying on
 * each handler to re-check.
 */
export const createTokenRequestSchema = z
  .object({
    name: z.string().min(1).max(255),
    scopes: z.array(ServiceTokenScope).min(1),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .superRefine((val, ctx) => {
    const parsed = new Date(val.expiresAt).getTime();
    if (Number.isNaN(parsed)) {
      // Already caught by the datetime() check above, but defensive.
      return;
    }
    const now = Date.now();
    if (parsed <= now) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'expiresAt must be strictly in the future',
      });
    } else if (parsed - now > SERVICE_TOKEN_MAX_TTL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'expiresAt must be within 90 days of now',
      });
    }
  });
export type CreateTokenRequest = z.infer<typeof createTokenRequestSchema>;

/**
 * Response body includes the plaintext `token` value — exposed ONLY on
 * create. All subsequent reads (GET) omit the `token` field.
 */
export const createdTokenSchema = z.object({
  id: z.string().uuid(),
  token: z.string().regex(/^sk_[A-Za-z0-9_-]+$/),
  name: z.string(),
  scopes: z.array(ServiceTokenScope),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});
export type CreatedToken = z.infer<typeof createdTokenSchema>;

export const createTokenResponseSchema = successResponseSchema(createdTokenSchema);
export type CreateTokenResponse = z.infer<typeof createTokenResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/auth/tokens
// ---------------------------------------------------------------------------

/**
 * List row shape — crucially DOES NOT include the plaintext `token`.
 * `lastUsedAt` is null until the token is first used.
 */
export const tokenListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  scopes: z.array(ServiceTokenScope),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
});
export type TokenListItem = z.infer<typeof tokenListItemSchema>;

export const listTokensResponseSchema = paginatedResponseSchema(tokenListItemSchema);
export type ListTokensResponse = z.infer<typeof listTokensResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/v1/auth/tokens/:id
// ---------------------------------------------------------------------------

export const deleteTokenParamsSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteTokenParams = z.infer<typeof deleteTokenParamsSchema>;

/**
 * Soft-delete: the token row is retained (revoked_at is set) for audit,
 * and the response echoes the revocation timestamp.
 */
export const deletedTokenSchema = z.object({
  id: z.string().uuid(),
  revokedAt: z.string().datetime({ offset: true }),
});
export type DeletedToken = z.infer<typeof deletedTokenSchema>;

export const deleteTokenResponseSchema = successResponseSchema(deletedTokenSchema);
export type DeleteTokenResponse = z.infer<typeof deleteTokenResponseSchema>;
