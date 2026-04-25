/**
 * Tests for DELETE /api/v1/auth/tokens/:id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticate, mockRevokeToken } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockRevokeToken: vi.fn(),
}));

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
}));

vi.mock('@/lib/auth/service-token-service', () => ({
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({ __fake: true }),
}));

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

function req(id: string): Request {
  return new Request(`https://example.test/api/v1/auth/tokens/${id}`, { method: 'DELETE' });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_ID = '11111111-2222-3333-4444-555555555555';

describe('DELETE /api/v1/auth/tokens/:id', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await DELETE(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(401);
  });

  it('400 when id is not a UUID', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    const res = await DELETE(req('not-a-uuid'), params('not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockRevokeToken).not.toHaveBeenCalled();
  });

  it('404 when token does not exist', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    mockRevokeToken.mockResolvedValue({ kind: 'not_found' });
    const res = await DELETE(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('403 when caller does not own the token', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    mockRevokeToken.mockResolvedValue({ kind: 'forbidden' });
    const res = await DELETE(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('200 when token is freshly revoked', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    const revokedAt = new Date('2026-04-10T00:00:00.000Z');
    mockRevokeToken.mockResolvedValue({ kind: 'revoked', id: VALID_ID, revokedAt });
    const res = await DELETE(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(VALID_ID);
    expect(body.data.revokedAt).toBe(revokedAt.toISOString());
  });

  it('200 idempotent when token was already revoked', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'u1', scopes: ['*'], authType: 'session' });
    const earlier = new Date('2026-04-01T00:00:00.000Z');
    mockRevokeToken.mockResolvedValue({ kind: 'revoked', id: VALID_ID, revokedAt: earlier });
    const res = await DELETE(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revokedAt).toBe(earlier.toISOString());
  });

  it('accepts service-token auth (for CLI self-service revoke)', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'owner-1',
      scopes: ['agents:read'],
      authType: 'service-token',
    });
    const revokedAt = new Date('2026-04-10T00:00:00.000Z');
    mockRevokeToken.mockResolvedValue({ kind: 'revoked', id: VALID_ID, revokedAt });

    const res = await DELETE(req(VALID_ID), params(VALID_ID));
    expect(res.status).toBe(200);
    expect(mockRevokeToken).toHaveBeenCalledWith(expect.anything(), VALID_ID, 'owner-1');
  });
});
