import { describe, expect, it } from 'vitest';
import {
  createTokenRequestSchema,
  createTokenResponseSchema,
  deleteTokenParamsSchema,
  listTokensResponseSchema,
} from '../auth.js';

// Use a dynamic future date so the TTL-≤-90-day guardrail doesn't trip as
// real time marches forward.
const future60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

const validCreateBody = {
  name: 'my-cli',
  scopes: ['agents:read', 'runs:write'],
  expiresAt: future60Days,
};

describe('createTokenRequestSchema', () => {
  it('accepts valid body', () => {
    expect(createTokenRequestSchema.parse(validCreateBody)).toEqual(validCreateBody);
  });

  it('rejects empty name', () => {
    expect(createTokenRequestSchema.safeParse({ ...validCreateBody, name: '' }).success).toBe(
      false
    );
  });

  it('rejects name > 255 chars', () => {
    expect(
      createTokenRequestSchema.safeParse({ ...validCreateBody, name: 'x'.repeat(256) }).success
    ).toBe(false);
  });

  it('rejects empty scopes array (v0.1 guardrail)', () => {
    expect(createTokenRequestSchema.safeParse({ ...validCreateBody, scopes: [] }).success).toBe(
      false
    );
  });

  it('rejects scopes containing "*" (wildcard not allowed on tokens)', () => {
    expect(createTokenRequestSchema.safeParse({ ...validCreateBody, scopes: ['*'] }).success).toBe(
      false
    );
    expect(
      createTokenRequestSchema.safeParse({
        ...validCreateBody,
        scopes: ['agents:read', '*'],
      }).success
    ).toBe(false);
  });

  it('rejects unknown scope strings', () => {
    expect(
      createTokenRequestSchema.safeParse({
        ...validCreateBody,
        scopes: ['agents:admin'],
      }).success
    ).toBe(false);
  });

  it('requires expiresAt', () => {
    const { expiresAt: _, ...body } = validCreateBody;
    expect(createTokenRequestSchema.safeParse(body).success).toBe(false);
  });

  it('rejects non-ISO expiresAt', () => {
    expect(
      createTokenRequestSchema.safeParse({ ...validCreateBody, expiresAt: 'not-a-date' }).success
    ).toBe(false);
    expect(
      createTokenRequestSchema.safeParse({ ...validCreateBody, expiresAt: '2026-07-01' }).success
    ).toBe(false);
  });

  it('rejects expiresAt already in the past', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      createTokenRequestSchema.safeParse({ ...validCreateBody, expiresAt: past }).success
    ).toBe(false);
  });

  it('rejects expiresAt > 90 days from now (v0.1 TTL cap)', () => {
    const beyond = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString();
    const result = createTokenRequestSchema.safeParse({ ...validCreateBody, expiresAt: beyond });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /90 days/.test(i.message))).toBe(true);
    }
  });

  it('accepts expiresAt exactly at 89 days from now (boundary-ish, under cap)', () => {
    const under = new Date(Date.now() + 89 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      createTokenRequestSchema.safeParse({ ...validCreateBody, expiresAt: under }).success
    ).toBe(true);
  });
});

describe('createTokenResponseSchema', () => {
  it('accepts envelope with plaintext token and sk_ prefix', () => {
    const parsed = createTokenResponseSchema.parse({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        token: 'sk_abc123_XYZ-def',
        name: 'cli',
        scopes: ['agents:read'],
        createdAt: '2026-04-25T00:00:00Z',
        expiresAt: '2026-07-25T00:00:00Z',
      },
    });
    expect(parsed.data.token).toMatch(/^sk_/);
  });

  it('rejects token without sk_ prefix', () => {
    const body = {
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        token: 'pk_123',
        name: 'cli',
        scopes: ['agents:read'],
        createdAt: '2026-04-25T00:00:00Z',
        expiresAt: '2026-07-25T00:00:00Z',
      },
    };
    expect(createTokenResponseSchema.safeParse(body).success).toBe(false);
  });

  it('rejects invalid UUID in id', () => {
    const body = {
      data: {
        id: 'not-a-uuid',
        token: 'sk_abc',
        name: 'cli',
        scopes: ['agents:read'],
        createdAt: '2026-04-25T00:00:00Z',
        expiresAt: '2026-07-25T00:00:00Z',
      },
    };
    expect(createTokenResponseSchema.safeParse(body).success).toBe(false);
  });
});

describe('listTokensResponseSchema', () => {
  it('accepts list without plaintext token', () => {
    const parsed = listTokensResponseSchema.parse({
      data: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'cli',
          scopes: ['agents:read'],
          createdAt: '2026-04-25T00:00:00Z',
          expiresAt: '2026-07-25T00:00:00Z',
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
      nextCursor: null,
    });
    expect(parsed.data).toHaveLength(1);
    // Item has no `token` field — strict by default, but Zod strips unknown.
    // We assert the item fields match the expected shape.
    expect((parsed.data[0] as Record<string, unknown>).token).toBeUndefined();
  });

  it('accepts nullable lastUsedAt / expiresAt / revokedAt', () => {
    const parsed = listTokensResponseSchema.parse({
      data: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'cli',
          scopes: ['agents:read'],
          createdAt: '2026-04-25T00:00:00Z',
          expiresAt: null,
          lastUsedAt: '2026-05-01T00:00:00Z',
          revokedAt: '2026-05-02T00:00:00Z',
        },
      ],
      nextCursor: 'c',
    });
    expect(parsed.data[0].expiresAt).toBeNull();
  });
});

describe('deleteTokenParamsSchema', () => {
  it('accepts valid UUID', () => {
    expect(deleteTokenParamsSchema.parse({ id: '00000000-0000-0000-0000-000000000001' })).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('rejects non-UUID', () => {
    expect(deleteTokenParamsSchema.safeParse({ id: '123' }).success).toBe(false);
  });
});
