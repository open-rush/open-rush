/**
 * /api/v1/auth/tokens — POST (issue) + GET (list).
 *
 * Source of truth:
 * - `specs/service-token-auth.md` §颁发流程 §v0.1 护栏
 * - `@open-rush/contracts` v1 (createTokenRequestSchema, listTokensResponseSchema)
 *
 * Behaviour:
 * - POST requires a NextAuth **session** (the endpoint refuses to let a
 *   service token "self-issue" another token — spec §颁发流程 前置条件).
 *   The contract layer (`createTokenRequestSchema`) already enforces scope
 *   and TTL guardrails; we only add the per-owner active-token cap (20).
 *   Response returns plaintext exactly once.
 * - GET allows both session AND service-token auth (a token can list its own
 *   owner's tokens). We never include plaintext or hash. Pagination is
 *   cursor-based (opaque string).
 */

import { v1 } from '@open-rush/contracts';
import { getDbClient } from '@open-rush/db';
import { createToken, listTokens, TokenCapExceededError } from '@/lib/auth/service-token-service';
import { authenticate } from '@/lib/auth/unified-auth';

const { ERROR_CODE_HTTP_STATUS, createTokenRequestSchema, paginationQuerySchema } = v1;

function jsonError(
  code: v1.ErrorCode,
  message: string,
  extra: { hint?: string; issues?: Array<{ path: Array<string | number>; message: string }> } = {}
): Response {
  const body: v1.ErrorResponse = { error: { code, message, ...extra } };
  return Response.json(body, { status: ERROR_CODE_HTTP_STATUS[code] });
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/tokens
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return jsonError('UNAUTHORIZED', 'authentication required');

  // Spec §颁发流程: only session-authenticated users may issue service tokens.
  if (auth.authType !== 'session') {
    return jsonError('FORBIDDEN', 'session authentication required to issue service tokens');
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError('VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = createTokenRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError('VALIDATION_ERROR', 'invalid request body', {
      issues: parsed.error.issues.map((i) => ({
        path: [...i.path] as Array<string | number>,
        message: i.message,
      })),
    });
  }

  const db = getDbClient();

  try {
    const row = await createToken(db, {
      ownerUserId: auth.userId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresAt: new Date(parsed.data.expiresAt),
    });

    const body: v1.CreateTokenResponse = {
      data: {
        id: row.id,
        token: row.token,
        name: row.name,
        scopes: row.scopes,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
    };
    return Response.json(body, { status: 201 });
  } catch (err) {
    if (err instanceof TokenCapExceededError) {
      return jsonError('VALIDATION_ERROR', `active token cap of ${err.cap} reached`, {
        hint: 'revoke an existing token first',
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/tokens
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return jsonError('UNAUTHORIZED', 'authentication required');

  const url = new URL(req.url);
  const params = {
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  };

  const parsedQuery = paginationQuerySchema.safeParse(params);
  if (!parsedQuery.success) {
    return jsonError('VALIDATION_ERROR', 'invalid pagination query', {
      issues: parsedQuery.error.issues.map((i) => ({
        path: [...i.path] as Array<string | number>,
        message: i.message,
      })),
    });
  }

  const db = getDbClient();
  const { items, nextCursor } = await listTokens(db, {
    ownerUserId: auth.userId,
    limit: parsedQuery.data.limit,
    cursor: parsedQuery.data.cursor,
  });

  const body: v1.ListTokensResponse = {
    data: items.map((it) => ({
      id: it.id,
      name: it.name,
      scopes: it.scopes,
      createdAt: it.createdAt.toISOString(),
      expiresAt: it.expiresAt ? it.expiresAt.toISOString() : null,
      lastUsedAt: it.lastUsedAt ? it.lastUsedAt.toISOString() : null,
      revokedAt: it.revokedAt ? it.revokedAt.toISOString() : null,
    })),
    nextCursor,
  };

  return Response.json(body, { status: 200 });
}
