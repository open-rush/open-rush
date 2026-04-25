import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AuthScope,
  ERROR_CODE_HTTP_STATUS,
  ErrorCode,
  errorResponseSchema,
  paginatedResponseSchema,
  paginationQuerySchema,
  ServiceTokenScope,
  successResponseSchema,
} from '../common.js';

describe('ErrorCode enum', () => {
  it('accepts all 8 spec codes', () => {
    for (const code of [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_ERROR',
      'VERSION_CONFLICT',
      'IDEMPOTENCY_CONFLICT',
      'RATE_LIMITED',
      'INTERNAL',
    ]) {
      expect(ErrorCode.parse(code)).toBe(code);
    }
  });

  it('rejects unknown codes', () => {
    expect(ErrorCode.safeParse('OOPS').success).toBe(false);
    expect(ErrorCode.safeParse('Unauthorized').success).toBe(false); // case-sensitive
    expect(ErrorCode.safeParse('').success).toBe(false);
  });

  it('HTTP status mapping is complete and matches spec', () => {
    expect(ERROR_CODE_HTTP_STATUS).toEqual({
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      VERSION_CONFLICT: 409,
      IDEMPOTENCY_CONFLICT: 409,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    });
  });
});

describe('errorResponseSchema', () => {
  it('accepts minimal valid error', () => {
    expect(
      errorResponseSchema.parse({
        error: { code: 'UNAUTHORIZED', message: 'no token' },
      })
    ).toEqual({ error: { code: 'UNAUTHORIZED', message: 'no token' } });
  });

  it('accepts hint + issues fields', () => {
    const parsed = errorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad input',
        hint: 'check fields',
        issues: [{ path: ['name'], message: 'required' }],
      },
    });
    expect(parsed.error.issues).toHaveLength(1);
  });

  it('rejects missing message', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'UNAUTHORIZED' } }).success).toBe(false);
  });

  it('rejects unknown error code', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(
      false
    );
  });

  it('rejects empty message', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'UNAUTHORIZED', message: '' } }).success
    ).toBe(false);
  });
});

describe('successResponseSchema', () => {
  const dataSchema = z.object({ id: z.string(), name: z.string() });
  const envelope = successResponseSchema(dataSchema);

  it('accepts envelope with valid data', () => {
    expect(envelope.parse({ data: { id: '1', name: 'a' } })).toEqual({
      data: { id: '1', name: 'a' },
    });
  });

  it('rejects envelope with missing data field', () => {
    expect(envelope.safeParse({}).success).toBe(false);
  });

  it('rejects envelope with extra data shape', () => {
    const result = envelope.safeParse({ data: { id: 1, name: 'a' } });
    expect(result.success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults limit to 50 when absent', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('coerces string limit to number', () => {
    expect(paginationQuerySchema.parse({ limit: '100' })).toEqual({ limit: 100 });
  });

  it('rejects limit > 200', () => {
    expect(paginationQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('rejects limit < 1', () => {
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: -1 }).success).toBe(false);
  });

  it('accepts opaque cursor string', () => {
    expect(paginationQuerySchema.parse({ cursor: 'abc123' })).toMatchObject({ cursor: 'abc123' });
  });
});

describe('paginatedResponseSchema', () => {
  const itemSchema = z.object({ id: z.string() });
  const listSchema = paginatedResponseSchema(itemSchema);

  it('accepts empty list + null cursor', () => {
    expect(listSchema.parse({ data: [], nextCursor: null })).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it('accepts populated list + string cursor', () => {
    expect(listSchema.parse({ data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'opaque' })).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'opaque',
    });
  });

  it('rejects missing nextCursor field (must be null or string, not absent)', () => {
    expect(listSchema.safeParse({ data: [] }).success).toBe(false);
  });
});

describe('ServiceTokenScope + AuthScope', () => {
  it('ServiceTokenScope has all 11 values from spec matrix', () => {
    const expected = [
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
    ];
    for (const s of expected) {
      expect(ServiceTokenScope.parse(s)).toBe(s);
    }
  });

  it('ServiceTokenScope explicitly rejects "*"', () => {
    expect(ServiceTokenScope.safeParse('*').success).toBe(false);
  });

  it('AuthScope accepts both "*" and concrete scopes', () => {
    expect(AuthScope.parse('*')).toBe('*');
    expect(AuthScope.parse('agents:read')).toBe('agents:read');
    expect(AuthScope.safeParse('nope:read').success).toBe(false);
  });
});
