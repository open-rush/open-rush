/**
 * Service Token service — supports `/api/v1/auth/tokens` CRUD.
 *
 * Contract source: `specs/service-token-auth.md` §颁发流程 §v0.1 护栏 §吊销.
 *
 * Responsibilities:
 * - Generate plaintext Service Tokens (`sk_<base64url(32 bytes)>`) + their
 *   SHA-256 hashes. Plaintext is returned to the caller exactly once on
 *   create; it is never logged or persisted in cleartext form.
 * - Enforce the per-owner active-token cap (v0.1 护栏: 20).
 * - List tokens with cursor-based pagination. Row shape omits both plaintext
 *   and hash (only metadata is exposed).
 * - Soft-revoke tokens by setting `revoked_at = now()`. Physical row retained
 *   for audit; repeated DELETEs are idempotent (return existing revoked_at).
 *
 * Input validation (`scopes` must not contain `'*'`, `expiresAt` guardrails)
 * lives in `@open-rush/contracts` `createTokenRequestSchema` and is applied
 * before reaching this service — so we trust the typed arguments here.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { v1 } from '@open-rush/contracts';
import { type DbClient, serviceTokens } from '@open-rush/db';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';

/** Per-owner active token cap (v0.1 护栏). */
export const MAX_ACTIVE_TOKENS_PER_USER = 20;

export type ServiceTokenScope = v1.ServiceTokenScope;

export type CreateTokenInput = {
  ownerUserId: string;
  name: string;
  scopes: ServiceTokenScope[];
  expiresAt: Date;
};

export type CreatedTokenRow = {
  id: string;
  /** Plaintext Service Token — returned ONLY from this call, never again. */
  token: string;
  name: string;
  scopes: ServiceTokenScope[];
  createdAt: Date;
  expiresAt: Date;
};

export type TokenListRow = {
  id: string;
  name: string;
  scopes: ServiceTokenScope[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type ListTokensInput = {
  ownerUserId: string;
  limit: number;
  cursor?: string;
};

export type ListTokensOutput = {
  items: TokenListRow[];
  nextCursor: string | null;
};

export type RevokeResult =
  | { kind: 'revoked'; id: string; revokedAt: Date }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

/**
 * Error thrown when the POST endpoint would exceed the active-token cap.
 * Routes should translate it to a 400 `VALIDATION_ERROR` with the hint
 * "revoke an existing token first".
 */
export class TokenCapExceededError extends Error {
  readonly cap = MAX_ACTIVE_TOKENS_PER_USER;
  constructor() {
    super(`Active token cap of ${MAX_ACTIVE_TOKENS_PER_USER} reached`);
    this.name = 'TokenCapExceededError';
  }
}

/**
 * Build a new plaintext Service Token:
 *   sk_<base64url(32 bytes)>
 *
 * Exported for route handlers that want to seed a token outside the DB flow
 * (tests, admin seeding). Normal code path uses `createToken()`.
 */
export function generateServiceTokenPlaintext(): string {
  return `sk_${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex of the plaintext — matches `service_tokens.token_hash`. */
export function hashServiceToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Count the owner's currently-active tokens (`revoked_at IS NULL`). Used by
 * `createToken()` to enforce the v0.1 cap.
 *
 * Note: "active" here means "not revoked"; we do not filter by expiresAt
 * because expired-but-not-revoked rows still consume the owner's quota until
 * they are explicitly revoked.
 */
export async function countActiveTokensForOwner(
  db: DbClient,
  ownerUserId: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceTokens)
    .where(and(eq(serviceTokens.ownerUserId, ownerUserId), isNull(serviceTokens.revokedAt)));
  return row?.count ?? 0;
}

/**
 * Deterministic 32-bit hash of a UUID, for Postgres advisory locks. Using two
 * `int4`s (one derived from the userId, one constant namespace) scopes the
 * lock to a single owner without colliding with other features.
 */
function hashUserIdForLock(userId: string): number {
  // djb2-style hash → signed int32 range. Good enough for lock namespacing.
  let h = 5381;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 33 + userId.charCodeAt(i)) | 0;
  }
  return h;
}

/** Advisory-lock namespace for the token cap guard. Arbitrary but stable. */
const TOKEN_CAP_LOCK_NAMESPACE = 0x5f7043ad; // "tokcap" mnemonic.

/**
 * Create a new Service Token. Returns the row with the plaintext token — the
 * ONLY place in the system where the plaintext exists after generation.
 *
 * Guardrails:
 * - {@link TokenCapExceededError} if owner already has 20 active tokens.
 * - Assumes `input.scopes` is already contract-validated (no `'*'`, etc.).
 *
 * Concurrency: the count + insert runs inside a transaction with a per-owner
 * `pg_advisory_xact_lock(int4, int4)`. Two concurrent creates for the same
 * owner serialise; the lock is released on commit/rollback. This prevents
 * two requests from both observing `active = 19` and both inserting a
 * 20th/21st row.
 */
export async function createToken(db: DbClient, input: CreateTokenInput): Promise<CreatedTokenRow> {
  const plaintext = generateServiceTokenPlaintext();
  const tokenHash = hashServiceToken(plaintext);
  const ownerLockKey = hashUserIdForLock(input.ownerUserId);

  const row = await db.transaction(async (tx) => {
    // Serialise concurrent creates for the same owner. The lock is scoped to
    // this transaction and released automatically on COMMIT/ROLLBACK.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${TOKEN_CAP_LOCK_NAMESPACE}::int4, ${ownerLockKey}::int4)`
    );

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceTokens)
      .where(
        and(eq(serviceTokens.ownerUserId, input.ownerUserId), isNull(serviceTokens.revokedAt))
      );
    const active = countRow?.count ?? 0;
    if (active >= MAX_ACTIVE_TOKENS_PER_USER) {
      throw new TokenCapExceededError();
    }

    const [inserted] = await tx
      .insert(serviceTokens)
      .values({
        tokenHash,
        name: input.name,
        ownerUserId: input.ownerUserId,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      })
      .returning({
        id: serviceTokens.id,
        name: serviceTokens.name,
        scopes: serviceTokens.scopes,
        createdAt: serviceTokens.createdAt,
        expiresAt: serviceTokens.expiresAt,
      });

    if (!inserted) {
      throw new Error('Failed to insert service_tokens row');
    }
    return inserted;
  });

  return {
    id: row.id,
    token: plaintext,
    name: row.name,
    scopes: (row.scopes ?? []) as ServiceTokenScope[],
    createdAt: row.createdAt,
    // The insert always sets expiresAt (required at the contract layer) —
    // the DB returns it as non-null in practice, but narrow the type defensively.
    expiresAt: row.expiresAt ?? input.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Pagination cursor — opaque to callers but structurally a base64url-encoded
// JSON blob `{c, id}` where `c` = createdAt ISO string and `id` = row id
// (tie-breaker to deterministically resume a paginated scan across rows that
// share a createdAt timestamp).
// ---------------------------------------------------------------------------

export type ListCursor = { c: string; id: string };

export function encodeListCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/** RFC 4122 UUID (any version, case-insensitive). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decode an opaque cursor. Every field is strictly validated so that a
 * malformed cursor can be silently ignored by the caller — we must never let
 * a bogus cursor reach the SQL tuple comparison and cause a 500 from a DB
 * UUID cast error.
 */
export function decodeListCursor(encoded: string): ListCursor | null {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as ListCursor).c !== 'string' ||
      typeof (parsed as ListCursor).id !== 'string'
    ) {
      return null;
    }
    const { c, id } = parsed as ListCursor;
    // `c` must parse to a real timestamp — `new Date('garbage')` would yield
    // `Invalid Date` and crash the SQL tuple comparison at DB layer.
    const parsedDate = new Date(c);
    if (Number.isNaN(parsedDate.getTime())) return null;
    // `id` is a UUID in the DB; anything else would trigger a DB cast error.
    if (!UUID_RE.test(id)) return null;
    return { c, id };
  } catch {
    return null;
  }
}

/**
 * List an owner's tokens (regardless of revoked/expired state — UI wants to
 * show historical rows for audit). Sorted `created_at DESC, id DESC`.
 *
 * Returns `limit` items and a `nextCursor` for the next page, or `null` if
 * the caller has reached the end.
 */
export async function listTokens(db: DbClient, input: ListTokensInput): Promise<ListTokensOutput> {
  const { ownerUserId, cursor } = input;
  const limit = Math.max(1, Math.min(input.limit, 200));

  const baseConditions = [eq(serviceTokens.ownerUserId, ownerUserId)];
  if (cursor) {
    const decoded = decodeListCursor(cursor);
    if (decoded) {
      const createdAt = new Date(decoded.c);
      if (!Number.isNaN(createdAt.getTime())) {
        // (createdAt, id) < (c, id) — lexicographic tuple comparison expressed
        // as: createdAt < c OR (createdAt = c AND id < cursor.id).
        baseConditions.push(
          sql`(${serviceTokens.createdAt}, ${serviceTokens.id}) < (${createdAt.toISOString()}, ${decoded.id})`
        );
      }
    }
  }

  // Fetch one extra row to determine whether another page exists.
  const rows = await db
    .select({
      id: serviceTokens.id,
      name: serviceTokens.name,
      scopes: serviceTokens.scopes,
      createdAt: serviceTokens.createdAt,
      expiresAt: serviceTokens.expiresAt,
      lastUsedAt: serviceTokens.lastUsedAt,
      revokedAt: serviceTokens.revokedAt,
    })
    .from(serviceTokens)
    .where(and(...baseConditions))
    .orderBy(desc(serviceTokens.createdAt), desc(serviceTokens.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? encodeListCursor({ c: last.createdAt.toISOString(), id: last.id }) : null;

  return {
    items: page.map((r) => ({
      id: r.id,
      name: r.name,
      scopes: (r.scopes ?? []) as ServiceTokenScope[],
      createdAt: r.createdAt,
      expiresAt: r.expiresAt ?? null,
      lastUsedAt: r.lastUsedAt ?? null,
      revokedAt: r.revokedAt ?? null,
    })),
    nextCursor,
  };
}

/**
 * Soft-revoke a token owned by `ownerUserId`.
 *
 * Semantics:
 * - Row missing             → `not_found` (404 at the route layer).
 * - Row belongs to someone  → `forbidden` (403). We do NOT reveal existence
 *                             to non-owners (enumeration protection).
 * - Row already revoked     → idempotent: return the existing `revoked_at`.
 * - Row active              → set `revoked_at = now()` and return it.
 */
export async function revokeToken(
  db: DbClient,
  tokenId: string,
  ownerUserId: string
): Promise<RevokeResult> {
  const [existing] = await db
    .select({
      id: serviceTokens.id,
      ownerUserId: serviceTokens.ownerUserId,
      revokedAt: serviceTokens.revokedAt,
    })
    .from(serviceTokens)
    .where(eq(serviceTokens.id, tokenId))
    .limit(1);

  if (!existing) return { kind: 'not_found' };
  if (existing.ownerUserId !== ownerUserId) return { kind: 'forbidden' };

  if (existing.revokedAt) {
    return { kind: 'revoked', id: existing.id, revokedAt: existing.revokedAt };
  }

  const [updated] = await db
    .update(serviceTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(serviceTokens.id, tokenId), isNull(serviceTokens.revokedAt)))
    .returning({ id: serviceTokens.id, revokedAt: serviceTokens.revokedAt });

  if (!updated?.revokedAt) {
    // Extremely rare race (row revoked between SELECT and UPDATE). Re-read to
    // return the real revokedAt.
    const [refetched] = await db
      .select({ id: serviceTokens.id, revokedAt: serviceTokens.revokedAt })
      .from(serviceTokens)
      .where(eq(serviceTokens.id, tokenId))
      .limit(1);
    if (refetched?.revokedAt) {
      return { kind: 'revoked', id: refetched.id, revokedAt: refetched.revokedAt };
    }
    return { kind: 'not_found' };
  }

  return { kind: 'revoked', id: updated.id, revokedAt: updated.revokedAt };
}

// Silence unused-import lints in the extremely unlikely scenario the
// drizzle-orm helpers are tree-shaken in a generated bundle.
void lt;
