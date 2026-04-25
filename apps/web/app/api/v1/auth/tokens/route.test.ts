/**
 * Tests for POST/GET /api/v1/auth/tokens.
 *
 * The route delegates DB work to the service layer, so we mock:
 * - `@/lib/auth/unified-auth` (authenticate) — gates auth
 * - `@/lib/auth/service-token-service` (createToken, listTokens, TokenCapExceededError)
 * - `@open-rush/db` (`getDbClient`) — just returns a sentinel
 *
 * Each test exercises a concrete request → response pair.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAuthenticate, mockCreateToken, mockListTokens, FakeCapErr } = vi.hoisted(() => {
  class Err extends Error {
    readonly cap = 20;
    constructor() {
      super('cap');
      this.name = 'TokenCapExceededError';
    }
  }
  return {
    mockAuthenticate: vi.fn(),
    mockCreateToken: vi.fn(),
    mockListTokens: vi.fn(),
    FakeCapErr: Err,
  };
});

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
}));

vi.mock('@/lib/auth/service-token-service', () => ({
  createToken: (...args: unknown[]) => mockCreateToken(...args),
  listTokens: (...args: unknown[]) => mockListTokens(...args),
  TokenCapExceededError: FakeCapErr,
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({ __fake: true }),
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonReq(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('https://example.test/api/v1/auth/tokens', init);
}

// Future expiresAt that is ≤ 90 days away (valid per contract).
function futureIso(daysFromNow = 60): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/tokens', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);

    const res = await POST(
      jsonReq('POST', { name: 'x', scopes: ['agents:read'], expiresAt: futureIso() })
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(mockCreateToken).not.toHaveBeenCalled();
  });

  it('403 when authenticated via service-token (self-issuance forbidden)', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'u1',
      scopes: ['agents:read'],
      authType: 'service-token',
    });

    const res = await POST(
      jsonReq('POST', { name: 'x', scopes: ['agents:read'], expiresAt: futureIso() })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockCreateToken).not.toHaveBeenCalled();
  });

  it('400 when body is invalid JSON', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const req = new Request('https://example.test/api/v1/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 when scopes contain "*" (contract layer)', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const res = await POST(
      jsonReq('POST', {
        name: 'x',
        scopes: ['*', 'agents:read'],
        expiresAt: futureIso(),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // The schema issue should mention an invalid scope.
    expect(JSON.stringify(body.error.issues)).toContain('scopes');
  });

  it('400 when expiresAt is in the past', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const res = await POST(
      jsonReq('POST', {
        name: 'x',
        scopes: ['agents:read'],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 when expiresAt is > 90 days', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const res = await POST(
      jsonReq('POST', {
        name: 'x',
        scopes: ['agents:read'],
        expiresAt: futureIso(120),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 with hint when token cap is reached', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    mockCreateToken.mockRejectedValue(new FakeCapErr());

    const res = await POST(
      jsonReq('POST', {
        name: 'x',
        scopes: ['agents:read'],
        expiresAt: futureIso(),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.hint).toMatch(/revoke/i);
  });

  it('201 with plaintext on success (session auth)', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    const expiresAt = new Date('2026-07-01T00:00:00.000Z');
    mockCreateToken.mockResolvedValue({
      id: 'tok-1',
      token: 'sk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abcdefghij',
      name: 'cli',
      scopes: ['agents:read'],
      createdAt,
      expiresAt,
    });

    const res = await POST(
      jsonReq('POST', {
        name: 'cli',
        scopes: ['agents:read'],
        expiresAt: expiresAt.toISOString(),
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('tok-1');
    expect(body.data.token).toMatch(/^sk_/);
    expect(body.data.scopes).toEqual(['agents:read']);
    expect(body.data.createdAt).toBe(createdAt.toISOString());
    expect(body.data.expiresAt).toBe(expiresAt.toISOString());
  });

  it('name=empty fails contract validation', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const res = await POST(
      jsonReq('POST', {
        name: '',
        scopes: ['agents:read'],
        expiresAt: futureIso(),
      })
    );

    expect(res.status).toBe(400);
    expect(mockCreateToken).not.toHaveBeenCalled();
  });

  it('empty scopes array fails contract validation', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const res = await POST(
      jsonReq('POST', {
        name: 'x',
        scopes: [],
        expiresAt: futureIso(),
      })
    );

    expect(res.status).toBe(400);
    expect(mockCreateToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/auth/tokens', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);

    const res = await GET(new Request('https://example.test/api/v1/auth/tokens'));
    expect(res.status).toBe(401);
  });

  it('lists own tokens, omits plaintext + hash', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    mockListTokens.mockResolvedValue({
      items: [
        {
          id: 't1',
          name: 'cli',
          scopes: ['agents:read'],
          createdAt,
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
      nextCursor: null,
    });

    const res = await GET(new Request('https://example.test/api/v1/auth/tokens'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data[0].id).toBe('t1');
    expect(body.nextCursor).toBeNull();

    // The serialized body MUST NOT contain plaintext or hash keys.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/"token"\s*:/);
    expect(serialized).not.toMatch(/token_hash|tokenHash/i);
    // And `listTokens` was called with the authed userId.
    expect(mockListTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerUserId: 'u1',
      })
    );
  });

  it('allows service-token auth and scopes the list to the token owner', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'owner-42',
      scopes: ['agents:read'],
      authType: 'service-token',
    });
    mockListTokens.mockResolvedValue({ items: [], nextCursor: null });

    const res = await GET(new Request('https://example.test/api/v1/auth/tokens'));
    expect(res.status).toBe(200);
    expect(mockListTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerUserId: 'owner-42',
      })
    );
  });

  it('400 on malformed pagination query', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });

    const res = await GET(
      new Request('https://example.test/api/v1/auth/tokens?limit=not-a-number')
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('passes cursor through', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    mockListTokens.mockResolvedValue({ items: [], nextCursor: null });

    await GET(new Request('https://example.test/api/v1/auth/tokens?limit=5&cursor=abc'));
    expect(mockListTokens).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: 5,
        cursor: 'abc',
      })
    );
  });
});
