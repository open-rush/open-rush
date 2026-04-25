/**
 * Tests for the unified `/api/v1/*` auth middleware.
 *
 * We mock `@/auth` (NextAuth wrapper) and `@open-rush/db` (Drizzle chain) so
 * the middleware can be exercised without a real Next.js runtime or PG.
 *
 * The goal is behavioural, not structural: each scenario describes a caller
 * condition and asserts the resulting {@link AuthContext} (or `null`).
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();
vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}));

// Drizzle chain capture: db.select(...).from(...).where(...).limit(1)
const selectRowsQueue: unknown[][] = [];
const selectCalls: Array<{ where: unknown }> = [];
const mockLimit = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

// Update chain: db.update(...).set(...).where(...).execute()
const updateExecuteMock = vi.fn();
const mockUpdateWhere = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdate = vi.fn();

function resetDbChain() {
  selectRowsQueue.length = 0;
  selectCalls.length = 0;

  mockLimit.mockReset();
  mockWhere.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();

  updateExecuteMock.mockReset();
  mockUpdateWhere.mockReset();
  mockUpdateSet.mockReset();
  mockUpdate.mockReset();

  mockLimit.mockImplementation(async () => {
    return selectRowsQueue.shift() ?? [];
  });
  mockWhere.mockImplementation((condition: unknown) => {
    selectCalls.push({ where: condition });
    return { limit: mockLimit };
  });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });

  updateExecuteMock.mockResolvedValue(undefined);
  mockUpdateWhere.mockReturnValue({ execute: updateExecuteMock });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
}

resetDbChain();

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
  serviceTokens: {
    id: 'service_tokens.id',
    tokenHash: 'service_tokens.token_hash',
    ownerUserId: 'service_tokens.owner_user_id',
    scopes: 'service_tokens.scopes',
    lastUsedAt: 'service_tokens.last_used_at',
    expiresAt: 'service_tokens.expires_at',
    revokedAt: 'service_tokens.revoked_at',
  },
}));

// drizzle-orm: we don't care about exact query shape in these tests — just
// that filters were composed. Return predictable tokens.
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ type: 'and', parts }),
  or: (...parts: unknown[]) => ({ type: 'or', parts }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  gt: (col: unknown, val: unknown) => ({ type: 'gt', col, val }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => ({
      type: 'sql',
      strings: [...strings],
    }),
    {
      raw: (s: string) => ({ type: 'sql.raw', sql: s }),
    }
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { type AuthContext, authenticate, hasScope } from './unified-auth';

beforeEach(() => {
  vi.clearAllMocks();
  resetDbChain();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/v1/ping', { headers });
}

function expectHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Session path
// ---------------------------------------------------------------------------

describe('authenticate — NextAuth session', () => {
  it('returns session context with wildcard scope when user is logged in', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const ctx = await authenticate(request());

    expect(ctx).toEqual({
      userId: 'user-1',
      scopes: ['*'],
      authType: 'session',
    });
    // No DB lookup when no Authorization header.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('falls back to session when Authorization is present but not "Bearer sk_…"', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } });

    const ctx = await authenticate(request({ authorization: 'Bearer something-else' }));

    expect(ctx).toEqual({ userId: 'user-2', scopes: ['*'], authType: 'session' });
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Service Token happy path
// ---------------------------------------------------------------------------

describe('authenticate — Service Token', () => {
  it('returns service-token context with declared scopes when token is valid', async () => {
    const raw = 'sk_valid_abc';
    selectRowsQueue.push([
      {
        id: 'token-1',
        ownerUserId: 'user-42',
        scopes: ['agents:read', 'runs:read'],
      },
    ]);

    const ctx = await authenticate(request({ authorization: `Bearer ${raw}` }));

    expect(ctx).toEqual({
      userId: 'user-42',
      scopes: ['agents:read', 'runs:read'],
      authType: 'service-token',
    });

    // Session path must NOT be consulted when the token matched.
    expect(mockAuth).not.toHaveBeenCalled();

    // Query used the SHA-256 of the plaintext (plaintext must not appear).
    const eqHashCall = mockWhereInvocations().flatPartsContaining(
      'eq',
      'service_tokens.token_hash'
    );
    expect(eqHashCall?.val).toBe(expectHash(raw));
    expect(eqHashCall?.val).not.toBe(raw);
  });

  it('bumps last_used_at asynchronously without awaiting', async () => {
    const raw = 'sk_async_1';
    selectRowsQueue.push([{ id: 'token-async', ownerUserId: 'user-1', scopes: ['runs:read'] }]);

    // Make the update resolve on the next microtask tick so we can observe
    // that authenticate() returned before it settled.
    let settled = false;
    updateExecuteMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          // Simulate async work: flip flag after current microtask.
          queueMicrotask(() => {
            settled = true;
            resolve();
          });
        })
    );

    const ctx = await authenticate(request({ authorization: `Bearer ${raw}` }));

    // authenticate() resolved immediately — the update might still be pending.
    expect(ctx?.authType).toBe('service-token');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    expect(updateExecuteMock).toHaveBeenCalledTimes(1);

    // Before flushing microtasks, the update may or may not have resolved —
    // but after flushing one tick it definitely has.
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('does not throw when the async last_used_at update rejects', async () => {
    const raw = 'sk_reject_1';
    selectRowsQueue.push([{ id: 'token-rej', ownerUserId: 'user-1', scopes: ['agents:read'] }]);
    updateExecuteMock.mockRejectedValue(new Error('db down'));

    // Must resolve without throwing even though the update rejects.
    const ctx = await authenticate(request({ authorization: `Bearer ${raw}` }));
    expect(ctx?.authType).toBe('service-token');

    // Flush the rejected promise so Node sees the attached catch.
    await Promise.resolve();
    await Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
// Service Token negative cases
// ---------------------------------------------------------------------------

describe('authenticate — Service Token rejections', () => {
  it('returns null when the token is unknown (no matching row)', async () => {
    selectRowsQueue.push([]);
    mockAuth.mockResolvedValue(null);

    const ctx = await authenticate(request({ authorization: 'Bearer sk_unknown' }));

    expect(ctx).toBeNull();
    // Once the Bearer sk_ path fails, we MUST NOT silently grant a session
    // context: session is reserved for cookie-based callers.
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('revoked tokens are filtered out (null row → null ctx)', async () => {
    // Filter happens in SQL via isNull(revoked_at); here we just assert that
    // a DB returning no row yields null.
    selectRowsQueue.push([]);
    const ctx = await authenticate(request({ authorization: 'Bearer sk_revoked' }));
    expect(ctx).toBeNull();
    // Assert the compiled WHERE included both isNull(revoked_at) and a gt() /
    // isNull(expires_at) branch, so the SQL layer is the source of truth.
    const invocations = mockWhereInvocations();
    expect(invocations.hasCondition('isNull', 'service_tokens.revoked_at')).toBe(true);
    expect(
      invocations.hasCondition('isNull', 'service_tokens.expires_at') ||
        invocations.hasCondition('gt', 'service_tokens.expires_at')
    ).toBe(true);
  });

  it('expired tokens are filtered out (null row → null ctx)', async () => {
    selectRowsQueue.push([]);
    const ctx = await authenticate(request({ authorization: 'Bearer sk_expired' }));
    expect(ctx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No auth
// ---------------------------------------------------------------------------

describe('authenticate — no credentials', () => {
  it('returns null when no Authorization header and no session', async () => {
    mockAuth.mockResolvedValue(null);
    const ctx = await authenticate(request());
    expect(ctx).toBeNull();
  });

  it('returns null when session resolves but has no user id', async () => {
    mockAuth.mockResolvedValue({ user: { name: 'Anonymous' } });
    const ctx = await authenticate(request());
    expect(ctx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasScope
// ---------------------------------------------------------------------------

describe('hasScope', () => {
  it('session wildcard grants any scope', () => {
    const ctx: AuthContext = {
      userId: 'u',
      scopes: ['*'],
      authType: 'session',
    };
    expect(hasScope(ctx, 'agents:read')).toBe(true);
    expect(hasScope(ctx, 'runs:cancel')).toBe(true);
    expect(hasScope(ctx, 'vaults:write')).toBe(true);
  });

  it('service-token matches only explicitly declared scopes', () => {
    const ctx: AuthContext = {
      userId: 'u',
      scopes: ['agents:read', 'runs:read'],
      authType: 'service-token',
    };
    expect(hasScope(ctx, 'agents:read')).toBe(true);
    expect(hasScope(ctx, 'runs:read')).toBe(true);
  });

  it('service-token without required scope → false', () => {
    const ctx: AuthContext = {
      userId: 'u',
      scopes: ['agents:read'],
      authType: 'service-token',
    };
    expect(hasScope(ctx, 'agents:write')).toBe(false);
    expect(hasScope(ctx, 'runs:cancel')).toBe(false);
  });

  it('empty scope list rejects everything', () => {
    const ctx: AuthContext = {
      userId: 'u',
      scopes: [],
      authType: 'service-token',
    };
    expect(hasScope(ctx, 'agents:read')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: read captured where() invocations to assert the compiled SQL AST.
// ---------------------------------------------------------------------------

type ConditionPart = { type: string; col?: unknown; val?: unknown; parts?: ConditionPart[] };

function mockWhereInvocations() {
  const flat: ConditionPart[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as ConditionPart;
    flat.push(n);
    if (Array.isArray(n.parts)) {
      for (const part of n.parts) visit(part);
    }
  };
  for (const c of selectCalls) visit(c.where);
  return {
    flatPartsContaining(type: string, col: string) {
      return flat.find((p) => p.type === type && p.col === col);
    },
    hasCondition(type: string, col: string) {
      return flat.some((p) => p.type === type && p.col === col);
    },
  };
}
