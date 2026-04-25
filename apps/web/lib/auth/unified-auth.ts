/**
 * Unified authentication middleware for `/api/v1/*` routes.
 *
 * Implements the dual-track scheme defined in `specs/service-token-auth.md`:
 * - Service Token  — `Authorization: Bearer sk_*` (machine-to-machine)
 * - NextAuth       — browser session cookies (web UI)
 *
 * Rules:
 * - Service Token is detected first when the Authorization header starts with
 *   `Bearer sk_`. Hashes of the plaintext are compared against
 *   `service_tokens.token_hash`; we never persist or log the plaintext.
 * - A matching row must have `revoked_at IS NULL` AND (`expires_at IS NULL` OR
 *   `expires_at > now()`). Anything else returns `null`.
 * - On a successful token lookup we fire a best-effort `UPDATE … SET
 *   last_used_at = now()`. It is intentionally NOT awaited so it never adds
 *   latency or failure modes to the authenticated request.
 * - If no Service Token matches, we fall back to `auth()` from `@/auth`
 *   (NextAuth v5 + local dev bypass).
 *
 * Security invariants:
 * - The plaintext token is only referenced inline, never logged, never echoed.
 * - Scope `'*'` is exclusive to session auth; Service Tokens carry their
 *   explicit declared scope list (the POST issuance endpoint rejects `'*'`).
 */
import { createHash } from 'node:crypto';
import type { v1 } from '@open-rush/contracts';
import { getDbClient, serviceTokens } from '@open-rush/db';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { auth } from '@/auth';

type AuthScope = v1.AuthScope;
type ServiceTokenScope = v1.ServiceTokenScope;

/**
 * Normalized authentication result carried through the route handler.
 *
 * - `scopes` is `['*']` for sessions, an explicit subset of
 *   {@link ServiceTokenScope} for Service Tokens.
 */
export type AuthContext = {
  userId: string;
  scopes: AuthScope[];
  authType: 'session' | 'service-token';
};

const BEARER_PREFIX = 'Bearer ';
const SERVICE_TOKEN_PREFIX = 'sk_';

/** SHA-256 hex digest — matches the format stored in `service_tokens.token_hash`. */
function hashServiceToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Identify the caller. Returns the resolved {@link AuthContext} or `null`
 * when neither auth method matches.
 *
 * Never throws for normal auth failures — callers translate `null` into an
 * `UNAUTHORIZED` response.
 */
export async function authenticate(req: Request): Promise<AuthContext | null> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');

  // --- Path 1: Service Token ------------------------------------------------
  if (header?.startsWith(BEARER_PREFIX)) {
    const raw = header.slice(BEARER_PREFIX.length).trim();
    if (raw.startsWith(SERVICE_TOKEN_PREFIX)) {
      const tokenHash = hashServiceToken(raw);
      const db = getDbClient();

      const [row] = await db
        .select({
          id: serviceTokens.id,
          ownerUserId: serviceTokens.ownerUserId,
          scopes: serviceTokens.scopes,
        })
        .from(serviceTokens)
        .where(
          and(
            eq(serviceTokens.tokenHash, tokenHash),
            isNull(serviceTokens.revokedAt),
            or(isNull(serviceTokens.expiresAt), gt(serviceTokens.expiresAt, new Date()))
          )
        )
        .limit(1);

      if (!row) return null;

      // Fire-and-forget: bump last_used_at without awaiting. We swallow errors
      // so DB hiccups never break an otherwise authenticated request.
      //
      // Using `.execute()` (promise) with an attached `.catch(() => {})` so
      // unhandled-rejection noise is suppressed; we intentionally do NOT
      // propagate the promise to the caller.
      const pending = db
        .update(serviceTokens)
        .set({ lastUsedAt: sql`now()` })
        .where(eq(serviceTokens.id, row.id))
        .execute();
      // Some fakes return a thenable without `.catch`; guard to avoid throwing.
      if (pending && typeof (pending as Promise<unknown>).catch === 'function') {
        (pending as Promise<unknown>).catch(() => {
          // Intentionally swallow; this is a best-effort bookkeeping write.
        });
      }

      const scopes = (row.scopes ?? []) as AuthScope[];
      return {
        userId: row.ownerUserId,
        scopes,
        authType: 'service-token',
      };
    }
    // Header was `Bearer …` but not a Service Token; fall through to session.
  }

  // --- Path 2: NextAuth session --------------------------------------------
  const session = await auth();
  const sessionUserId = session?.user?.id;
  if (sessionUserId) {
    return {
      userId: sessionUserId,
      scopes: ['*'],
      authType: 'session',
    };
  }

  return null;
}

/**
 * Check whether `ctx` is allowed to perform an action gated by `required`.
 *
 * - Sessions hold `'*'` which matches every scope.
 * - Service Tokens must list the required scope explicitly.
 */
export function hasScope(ctx: AuthContext, required: ServiceTokenScope): boolean {
  return ctx.scopes.includes('*') || ctx.scopes.includes(required);
}
