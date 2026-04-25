import { describe, expect, it } from 'vitest';
import {
  cancelRunResponseSchema,
  createRunRequestSchema,
  createRunResponseSchema,
  getRunParamsSchema,
  idempotencyKeyHeaderSchema,
  lastEventIdHeaderSchema,
  listRunsQuerySchema,
  openrushExtensionPartSchema,
  openrushRunDonePartSchema,
  openrushRunStartedPartSchema,
  runEventPayloadSchema,
  runEventSseFrameSchema,
  runSchema,
} from '../runs.js';

const run = {
  id: '00000000-0000-0000-0000-000000000030',
  agentId: '00000000-0000-0000-0000-000000000010',
  taskId: '00000000-0000-0000-0000-000000000020',
  conversationId: null,
  parentRunId: null,
  status: 'running' as const,
  prompt: 'hi',
  provider: 'claude-code',
  connectionMode: 'anthropic' as const,
  modelId: null,
  triggerSource: 'user' as const,
  agentDefinitionVersion: 2,
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
  startedAt: null,
  completedAt: null,
};

describe('createRunRequestSchema', () => {
  it('accepts minimal body', () => {
    expect(createRunRequestSchema.parse({ input: 'hello' }).input).toBe('hello');
  });

  it('rejects empty input', () => {
    expect(createRunRequestSchema.safeParse({ input: '' }).success).toBe(false);
  });

  it('accepts attachments with optional fields', () => {
    expect(
      createRunRequestSchema.parse({
        input: 'go',
        attachments: [{ name: 'a.txt' }, { name: 'b.png', url: 'https://x/y.png' }],
      }).attachments?.length
    ).toBe(2);
  });

  it('rejects attachment with invalid URL', () => {
    expect(
      createRunRequestSchema.safeParse({
        input: 'go',
        attachments: [{ name: 'a', url: 'not-a-url' }],
      }).success
    ).toBe(false);
  });
});

describe('idempotencyKeyHeaderSchema', () => {
  it('accepts URL-safe ASCII keys', () => {
    expect(idempotencyKeyHeaderSchema.parse('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it('accepts UUIDs', () => {
    expect(idempotencyKeyHeaderSchema.parse('00000000-0000-0000-0000-000000000001')).toContain(
      '00000000'
    );
  });

  it('rejects keys with spaces / special chars', () => {
    expect(idempotencyKeyHeaderSchema.safeParse('has space').success).toBe(false);
    expect(idempotencyKeyHeaderSchema.safeParse('a/b').success).toBe(false);
  });

  it('rejects > 255 chars', () => {
    expect(idempotencyKeyHeaderSchema.safeParse('a'.repeat(256)).success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(idempotencyKeyHeaderSchema.safeParse('').success).toBe(false);
  });
});

describe('lastEventIdHeaderSchema', () => {
  it('coerces string to int ≥ 0', () => {
    expect(lastEventIdHeaderSchema.parse('42')).toBe(42);
    expect(lastEventIdHeaderSchema.parse('0')).toBe(0);
  });

  it('rejects negatives', () => {
    expect(lastEventIdHeaderSchema.safeParse('-1').success).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(lastEventIdHeaderSchema.safeParse('1.5').success).toBe(false);
  });
});

describe('runSchema', () => {
  it('round-trips a valid entity', () => {
    expect(runSchema.parse(run).status).toBe('running');
  });

  it('accepts nullable agentDefinitionVersion (migration-compat)', () => {
    expect(
      runSchema.parse({ ...run, agentDefinitionVersion: null }).agentDefinitionVersion
    ).toBeNull();
  });

  it('rejects status "purple"', () => {
    expect(runSchema.safeParse({ ...run, status: 'purple' }).success).toBe(false);
  });
});

describe('createRunResponseSchema + listRunsQuerySchema + cancel/get', () => {
  it('createRunResponseSchema wraps a run', () => {
    expect(createRunResponseSchema.parse({ data: run }).data.id).toBeTruthy();
  });

  it('listRunsQuerySchema accepts status filter', () => {
    expect(listRunsQuerySchema.parse({ status: 'running' }).status).toBe('running');
  });

  it('getRunParamsSchema requires both ids', () => {
    expect(
      getRunParamsSchema.parse({
        id: '00000000-0000-0000-0000-000000000010',
        runId: '00000000-0000-0000-0000-000000000030',
      })
    ).toMatchObject({ id: expect.any(String) });
    expect(
      getRunParamsSchema.safeParse({ id: '00000000-0000-0000-0000-000000000010' }).success
    ).toBe(false);
  });

  it('cancelRunResponseSchema returns the run', () => {
    expect(cancelRunResponseSchema.parse({ data: run }).data.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Event payload + SSE frame
// ---------------------------------------------------------------------------

describe('Open-rush extension event parts', () => {
  it('openrushRunStartedPartSchema accepts valid payload', () => {
    expect(
      openrushRunStartedPartSchema.parse({
        type: 'data-openrush-run-started',
        data: {
          runId: '00000000-0000-0000-0000-000000000030',
          agentId: '00000000-0000-0000-0000-000000000010',
          definitionVersion: 2,
        },
      }).type
    ).toBe('data-openrush-run-started');
  });

  it('openrushRunDonePartSchema enforces status enum', () => {
    expect(
      openrushRunDonePartSchema.safeParse({
        type: 'data-openrush-run-done',
        data: { status: 'mysterious' },
      }).success
    ).toBe(false);
    expect(
      openrushRunDonePartSchema.parse({
        type: 'data-openrush-run-done',
        data: { status: 'cancelled' },
      }).data.status
    ).toBe('cancelled');
  });

  it('openrushExtensionPartSchema discriminates by type', () => {
    const parsed = openrushExtensionPartSchema.parse({
      type: 'data-openrush-usage',
      data: { tokensIn: 10, tokensOut: 5, costUsd: 0.01 },
    });
    expect(parsed.type).toBe('data-openrush-usage');
  });
});

describe('runEventPayloadSchema accepts all UIMessageChunk variants', () => {
  // The runtime emits AI SDK UIMessageChunk (streaming format), not the
  // higher-level UIMessagePart. Tests align with enums.ts → UIMessageChunkType
  // and the reconstruct-messages consumer.

  it('text-delta chunk', () => {
    expect(runEventPayloadSchema.parse({ type: 'text-delta', id: 'm1', delta: 'hi' }).type).toBe(
      'text-delta'
    );
  });

  it('text-start / text-end chunks', () => {
    expect(runEventPayloadSchema.parse({ type: 'text-start', id: 'm1' }).type).toBe('text-start');
    expect(runEventPayloadSchema.parse({ type: 'text-end', id: 'm1' }).type).toBe('text-end');
  });

  it('reasoning chunks', () => {
    for (const t of ['reasoning-start', 'reasoning-delta', 'reasoning-end']) {
      expect(runEventPayloadSchema.parse({ type: t, id: 'r1' }).type).toBe(t);
    }
  });

  it('tool-input-delta incremental input stream', () => {
    expect(
      runEventPayloadSchema.parse({
        type: 'tool-input-delta',
        toolCallId: 'call_1',
        delta: '{"pa',
      }).type
    ).toBe('tool-input-delta');
  });

  it('tool-input-start with toolName', () => {
    expect(
      runEventPayloadSchema.parse({
        type: 'tool-input-start',
        toolCallId: 'call_1',
        toolName: 'Read',
      }).type
    ).toBe('tool-input-start');
  });

  it('tool-input-available with input blob', () => {
    expect(
      runEventPayloadSchema.parse({
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'Read',
        input: { path: '/tmp/x' },
      }).type
    ).toBe('tool-input-available');
  });

  it('tool-output-available with output blob', () => {
    expect(
      runEventPayloadSchema.parse({
        type: 'tool-output-available',
        toolCallId: 'call_1',
        output: 'file contents',
      }).type
    ).toBe('tool-output-available');
  });

  it('tool-output-error with errorText', () => {
    expect(
      runEventPayloadSchema.parse({
        type: 'tool-output-error',
        toolCallId: 'call_1',
        errorText: 'boom',
      }).type
    ).toBe('tool-output-error');
  });

  it('start / finish / error / start-step / finish-step', () => {
    expect(runEventPayloadSchema.parse({ type: 'start', messageId: 'm1' }).type).toBe('start');
    expect(runEventPayloadSchema.parse({ type: 'finish', reason: 'stop' }).type).toBe('finish');
    expect(runEventPayloadSchema.parse({ type: 'error', errorText: 'x' }).type).toBe('error');
    expect(runEventPayloadSchema.parse({ type: 'start-step' }).type).toBe('start-step');
    expect(runEventPayloadSchema.parse({ type: 'finish-step', reason: 'stop' }).type).toBe(
      'finish-step'
    );
  });

  it('data-* generic chunk', () => {
    expect(
      runEventPayloadSchema.parse({
        type: 'data-custom-key',
        id: 'x',
        data: { anything: true },
      }).type
    ).toBe('data-custom-key');
  });

  it('rejects a generic data-* using the reserved data-openrush-* prefix', () => {
    expect(
      runEventPayloadSchema.safeParse({
        type: 'data-openrush-unknown',
        data: { anything: true },
      }).success
    ).toBe(false);
  });

  it('rejects unknown chunk type', () => {
    expect(runEventPayloadSchema.safeParse({ type: 'step-finish' }).success).toBe(false);
    expect(runEventPayloadSchema.safeParse({ type: 'tool-call', toolCallId: 'x' }).success).toBe(
      false
    );
  });
});

describe('runEventSseFrameSchema', () => {
  it('accepts a valid frame (id >= 1, data = chunk payload)', () => {
    expect(
      runEventSseFrameSchema.parse({
        id: 1,
        data: { type: 'text-delta', id: 'm1', delta: 'x' },
      }).id
    ).toBe(1);
  });

  it('rejects id < 1 (seq starts at 1 per spec)', () => {
    expect(runEventSseFrameSchema.safeParse({ id: 0, data: { type: 'start-step' } }).success).toBe(
      false
    );
  });
});
