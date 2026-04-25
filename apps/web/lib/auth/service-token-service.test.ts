// biome-ignore-all lint/suspicious/noThenProperty: intentional Drizzle-style
// thenable mock; the chain must satisfy `await db.select().from().where()`.
/**
 * Tests for the Service Token service layer.
 *
 * We mock `@open-rush/db` so the service runs without a real Postgres.
 * The tests exercise every branch that the route handlers care about:
 * - plaintext generation format
 * - SHA-256 hash correctness
 * - active-token cap (20)
 * - pagination cursor round-trip + hasMore semantics
 * - revoke kinds (revoked / not_found / forbidden / idempotent)
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock: minimal Drizzle-style chains for the calls made in the service.
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

const selectQueue: AnyRow[][] = [];
const insertQueue: AnyRow[][] = [];
const updateQueue: AnyRow[][] = [];
const selectCalls: Array<AnyRow> = [];
const insertCalls: Array<{ table: unknown; values: unknown }> = [];
const updateCalls: Array<{ table: unknown; set?: unknown; where?: unknown }> = [];

/**
 * Build a thenable "query" object. The first unconsumed row list in
 * `selectQueue` resolves the promise. `where()`, `orderBy()`, and `limit()`
 * chain and all return the same thenable.
 */
type ThenableChain = {
  then: (
    onFulfilled?: ((v: unknown[]) => unknown) | null,
    onRejected?: (r: unknown) => unknown
  ) => Promise<unknown>;
  where: (cond: unknown) => ThenableChain;
  orderBy: (...c: unknown[]) => ThenableChain;
  limit: (n: number) => ThenableChain;
};

function makeThenable(call: AnyRow): ThenableChain {
  const resolve = () => Promise.resolve(selectQueue.shift() ?? []);
  const chain = {} as ThenableChain;
  chain.then = (onFulfilled, onRejected) => resolve().then(onFulfilled ?? undefined, onRejected);
  chain.where = vi.fn((cond: unknown) => {
    call.where = cond;
    return chain;
  });
  chain.orderBy = vi.fn((...c: unknown[]) => {
    call.orderBy = c;
    return chain;
  });
  chain.limit = vi.fn((n: number) => {
    call.limit = n;
    return chain;
  });
  return chain;
}

function makeSelectChain(): ReturnType<typeof vi.fn> {
  return vi.fn((_cols?: unknown) => {
    const call: AnyRow = {};
    selectCalls.push(call);
    const thenable = makeThenable(call);
    const from = vi.fn((table: unknown) => {
      call.from = table;
      return thenable;
    });
    return { from };
  });
}

const mockSelect = makeSelectChain();

const mockInsert = vi.fn((table: unknown) => {
  const call: AnyRow = { table };
  insertCalls.push({ table, values: undefined });
  const values = vi.fn((v: unknown) => {
    call.values = v;
    insertCalls[insertCalls.length - 1].values = v;
    const returning = vi.fn(async (_cols?: unknown) => {
      return insertQueue.shift() ?? [];
    });
    return { returning };
  });
  return { values };
});

const mockUpdate = vi.fn((table: unknown) => {
  const call: AnyRow = { table };
  updateCalls.push({ table });
  const set = vi.fn((v: unknown) => {
    call.set = v;
    updateCalls[updateCalls.length - 1].set = v;
    const where = vi.fn((cond: unknown) => {
      call.where = cond;
      updateCalls[updateCalls.length - 1].where = cond;
      const returning = vi.fn(async (_cols?: unknown) => {
        return updateQueue.shift() ?? [];
      });
      return { returning };
    });
    return { where };
  });
  return { set };
});

function resetDb() {
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
  selectCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  mockSelect.mockClear();
  mockInsert.mockClear();
  mockUpdate.mockClear();
}

const mockExecute = vi.fn(async () => undefined);
const mockTransaction = vi.fn(
  async (
    fn: (tx: {
      select: unknown;
      insert: unknown;
      update: unknown;
      execute: unknown;
    }) => Promise<unknown>
  ) =>
    fn({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      execute: mockExecute,
    })
);

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    execute: mockExecute,
    transaction: mockTransaction,
  }),
  serviceTokens: {
    id: 'service_tokens.id',
    tokenHash: 'service_tokens.token_hash',
    name: 'service_tokens.name',
    ownerUserId: 'service_tokens.owner_user_id',
    scopes: 'service_tokens.scopes',
    lastUsedAt: 'service_tokens.last_used_at',
    expiresAt: 'service_tokens.expires_at',
    revokedAt: 'service_tokens.revoked_at',
    createdAt: 'service_tokens.created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ type: 'and', parts }),
  desc: (col: unknown) => ({ type: 'desc', col }),
  eq: (col: unknown, val: unknown) => ({ type: 'eq', col, val }),
  isNull: (col: unknown) => ({ type: 'isNull', col }),
  lt: (col: unknown, val: unknown) => ({ type: 'lt', col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      type: 'sql',
      strings: [...strings],
      values,
    }),
    {
      raw: (s: string) => ({ type: 'sql.raw', sql: s }),
    }
  ),
}));

// ---------------------------------------------------------------------------
// Imports (must follow the mocks)
// ---------------------------------------------------------------------------

import { getDbClient } from '@open-rush/db';
import {
  countActiveTokensForOwner,
  createToken,
  decodeListCursor,
  encodeListCursor,
  generateServiceTokenPlaintext,
  hashServiceToken,
  listTokens,
  MAX_ACTIVE_TOKENS_PER_USER,
  revokeToken,
  TokenCapExceededError,
} from './service-token-service';

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
});

// ---------------------------------------------------------------------------
// Plaintext + hash
// ---------------------------------------------------------------------------

describe('generateServiceTokenPlaintext', () => {
  it('emits a sk_-prefixed base64url string of sufficient length', () => {
    const tok = generateServiceTokenPlaintext();
    expect(tok).toMatch(/^sk_[A-Za-z0-9_-]+$/);
    // 32 random bytes → 43 base64url chars; prefix is 3 → total >= 46.
    expect(tok.length).toBeGreaterThanOrEqual(46);
  });

  it('produces distinct tokens across calls', () => {
    const a = generateServiceTokenPlaintext();
    const b = generateServiceTokenPlaintext();
    expect(a).not.toBe(b);
  });
});

describe('hashServiceToken', () => {
  it('matches the canonical SHA-256 hex digest', () => {
    const raw = 'sk_hello_world';
    expect(hashServiceToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
  });
});

// ---------------------------------------------------------------------------
// countActiveTokensForOwner
// ---------------------------------------------------------------------------

describe('countActiveTokensForOwner', () => {
  it('returns the integer count from the DB', async () => {
    selectQueue.push([{ count: 5 }]);
    const db = getDbClient();
    const n = await countActiveTokensForOwner(db, 'user-1');
    expect(n).toBe(5);
  });

  it('returns 0 when the DB returns nothing', async () => {
    selectQueue.push([]);
    const db = getDbClient();
    const n = await countActiveTokensForOwner(db, 'user-1');
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createToken
// ---------------------------------------------------------------------------

describe('createToken', () => {
  it('inserts with a SHA-256 hash (never the plaintext)', async () => {
    selectQueue.push([{ count: 0 }]);
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    const expiresAt = new Date('2026-07-01T00:00:00.000Z');
    insertQueue.push([
      {
        id: 'tok-1',
        name: 'cli',
        scopes: ['agents:read'],
        createdAt,
        expiresAt,
      },
    ]);
    const db = getDbClient();

    const row = await createToken(db, {
      ownerUserId: 'user-1',
      name: 'cli',
      scopes: ['agents:read'],
      expiresAt,
    });

    expect(row.id).toBe('tok-1');
    expect(row.token).toMatch(/^sk_/);
    expect(row.scopes).toEqual(['agents:read']);
    expect(row.createdAt).toEqual(createdAt);
    expect(row.expiresAt).toEqual(expiresAt);

    // The insert must have used the SHA-256 of the returned plaintext.
    const insertArgs = insertCalls[0]?.values as { tokenHash?: string };
    expect(insertArgs?.tokenHash).toBe(hashServiceToken(row.token));
    // …and crucially, the plaintext itself must not leak into tokenHash.
    expect(insertArgs?.tokenHash).not.toBe(row.token);
  });

  it('rejects with TokenCapExceededError at the cap', async () => {
    selectQueue.push([{ count: MAX_ACTIVE_TOKENS_PER_USER }]);
    const db = getDbClient();

    await expect(
      createToken(db, {
        ownerUserId: 'user-1',
        name: 'cli',
        scopes: ['agents:read'],
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      })
    ).rejects.toBeInstanceOf(TokenCapExceededError);
    // Must not hit insert when the cap is reached.
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects with TokenCapExceededError above the cap (defensive)', async () => {
    selectQueue.push([{ count: MAX_ACTIVE_TOKENS_PER_USER + 3 }]);
    const db = getDbClient();

    await expect(
      createToken(db, {
        ownerUserId: 'user-1',
        name: 'cli',
        scopes: ['agents:read'],
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      })
    ).rejects.toBeInstanceOf(TokenCapExceededError);
  });
});

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

describe('encode/decodeListCursor', () => {
  const VALID_UUID = '11111111-2222-3333-4444-555555555555';

  it('round-trips an object with a valid UUID + ISO timestamp', () => {
    const cur = { c: '2026-04-01T00:00:00.000Z', id: VALID_UUID };
    const encoded = encodeListCursor(cur);
    expect(decodeListCursor(encoded)).toEqual(cur);
  });

  it('returns null for garbage input', () => {
    expect(decodeListCursor('not-base64!!')).toBeNull();
    // Valid base64 but not JSON
    expect(decodeListCursor(Buffer.from('not-json', 'utf8').toString('base64url'))).toBeNull();
  });

  it('returns null for structurally-wrong JSON', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(decodeListCursor(bad)).toBeNull();
  });

  it('returns null when `id` is not a UUID (would crash SQL tuple cast)', () => {
    const encoded = encodeListCursor({ c: '2026-04-01T00:00:00.000Z', id: 'not-a-uuid' });
    expect(decodeListCursor(encoded)).toBeNull();
  });

  it('returns null when `c` is not a parseable date', () => {
    const encoded = encodeListCursor({ c: 'not-a-date', id: VALID_UUID });
    expect(decodeListCursor(encoded)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listTokens
// ---------------------------------------------------------------------------

describe('listTokens', () => {
  it('returns rows with nextCursor=null when there are no more pages', async () => {
    const now = new Date('2026-04-01T00:00:00.000Z');
    selectQueue.push([
      {
        id: 'tok-a',
        name: 'a',
        scopes: ['agents:read'],
        createdAt: now,
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    const db = getDbClient();

    const out = await listTokens(db, { ownerUserId: 'user-1', limit: 10 });

    expect(out.items.length).toBe(1);
    expect(out.items[0]?.id).toBe('tok-a');
    expect(out.nextCursor).toBeNull();
  });

  it('emits a nextCursor when more rows exist (fetched limit+1)', async () => {
    const t = (s: string) => new Date(s);
    selectQueue.push([
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'r1',
        scopes: [],
        createdAt: t('2026-04-10T00:00:00Z'),
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'r2',
        scopes: [],
        createdAt: t('2026-04-09T00:00:00Z'),
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
      },
      // The 3rd row signals that another page exists; it must not appear in the output.
      {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'r3',
        scopes: [],
        createdAt: t('2026-04-08T00:00:00Z'),
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    const db = getDbClient();

    const out = await listTokens(db, { ownerUserId: 'user-1', limit: 2 });

    expect(out.items.map((i) => i.id)).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(out.nextCursor).not.toBeNull();
    const decoded = decodeListCursor(out.nextCursor as string);
    // The cursor must point to the LAST returned row (r2), not the peek (r3).
    expect(decoded?.id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('clamps limit to the legal range', async () => {
    selectQueue.push([]);
    const db = getDbClient();
    await listTokens(db, { ownerUserId: 'user-1', limit: 10_000 });
    // Fetched limit+1, capped at 200+1.
    const innerLimit = selectCalls[0]?.limit;
    expect(innerLimit).toBe(201);
  });

  it('ignores an obviously-malformed cursor', async () => {
    selectQueue.push([]);
    const db = getDbClient();
    // Must not throw.
    const out = await listTokens(db, {
      ownerUserId: 'user-1',
      limit: 10,
      cursor: 'this-is-not-base64!!',
    });
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// revokeToken
// ---------------------------------------------------------------------------

describe('revokeToken', () => {
  it('returns not_found when the token is missing', async () => {
    selectQueue.push([]);
    const db = getDbClient();
    const r = await revokeToken(db, '00000000-0000-0000-0000-000000000001', 'user-1');
    expect(r.kind).toBe('not_found');
  });

  it('returns forbidden when caller does not own the row', async () => {
    selectQueue.push([{ id: 't1', ownerUserId: 'user-OTHER', revokedAt: null }]);
    const db = getDbClient();
    const r = await revokeToken(db, 't1', 'user-1');
    expect(r.kind).toBe('forbidden');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent when already revoked', async () => {
    const existing = new Date('2026-04-01T00:00:00.000Z');
    selectQueue.push([{ id: 't1', ownerUserId: 'user-1', revokedAt: existing }]);
    const db = getDbClient();
    const r = await revokeToken(db, 't1', 'user-1');
    expect(r).toEqual({ kind: 'revoked', id: 't1', revokedAt: existing });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('revokes an active token and returns its new revokedAt', async () => {
    const newlyRevoked = new Date('2026-04-10T00:00:00.000Z');
    selectQueue.push([{ id: 't1', ownerUserId: 'user-1', revokedAt: null }]);
    updateQueue.push([{ id: 't1', revokedAt: newlyRevoked }]);
    const db = getDbClient();
    const r = await revokeToken(db, 't1', 'user-1');
    expect(r).toEqual({ kind: 'revoked', id: 't1', revokedAt: newlyRevoked });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the UPDATE returns no rows (rare race)', async () => {
    const actual = new Date('2026-04-10T00:00:00.000Z');
    selectQueue.push([{ id: 't1', ownerUserId: 'user-1', revokedAt: null }]);
    // UPDATE returned no rows — someone else revoked it.
    updateQueue.push([]);
    // Re-read finds the existing revokedAt.
    selectQueue.push([{ id: 't1', revokedAt: actual }]);
    const db = getDbClient();
    const r = await revokeToken(db, 't1', 'user-1');
    expect(r).toEqual({ kind: 'revoked', id: 't1', revokedAt: actual });
  });
});
