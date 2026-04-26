/**
 * Tests for GET /api/v1/agents/:agentId/runs/:runId/events (SSE).
 *
 * We mock `DrizzleEventStore` and `RunService` so tests can simulate
 * `run_events` reads and terminal transitions without Postgres. The
 * live polling branch uses `vi.useFakeTimers()` to advance time deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockGetById,
  mockGetEvents,
  mockIsTerminal,
  dbFake,
} = vi.hoisted(() => {
  const selectSpy = vi.fn();
  function makeSelectChain(projArgs: unknown[]) {
    const invocation = selectSpy({ kind: 'select', projArgs });
    const result = Array.isArray(invocation) ? invocation : [];
    const chain: {
      from: (t: unknown) => typeof chain;
      where: (p: unknown) => typeof chain & Promise<unknown[]>;
      limit: (n: number) => Promise<unknown[]>;
    } = {
      from: () => chain,
      where: () => {
        const asPromise = Promise.resolve(result) as Promise<unknown[]>;
        return Object.assign(asPromise, chain) as typeof chain & Promise<unknown[]>;
      },
      limit: () => Promise.resolve(result),
    };
    return chain;
  }
  return {
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockGetById: vi.fn(),
    mockGetEvents: vi.fn(),
    mockIsTerminal: vi.fn(),
    dbFake: {
      __select: selectSpy,
      select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
    },
  };
});

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

vi.mock('@open-rush/control-plane', () => ({
  DrizzleRunDb: class {},
  RunService: class {
    getById = mockGetById;
  },
  DrizzleEventStore: class {
    getEvents = mockGetEvents;
  },
  isTerminal: (status: string) => mockIsTerminal(status),
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => dbFake,
  tasks: { id: 't.id', projectId: 't.pid' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
}));

import { GET } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const TASK_ID = '00000000-0000-0000-0000-000000000111';
const RUN_ID = '00000000-0000-0000-0000-000000000222';

function sessionAuth() {
  return { userId: 'user-1', scopes: ['*'], authType: 'session' as const };
}

function params(agentId: string, runId: string) {
  return Promise.resolve({ agentId, runId });
}

function req(init?: { headers?: Record<string, string>; signal?: AbortSignal }): Request {
  return new Request(`https://t/api/v1/agents/${TASK_ID}/runs/${RUN_ID}/events`, {
    headers: init?.headers,
    signal: init?.signal,
  });
}

const SAMPLE_RUN = {
  id: RUN_ID,
  agentId: '00000000-0000-0000-0000-000000000aaa',
  taskId: TASK_ID,
  conversationId: null,
  parentRunId: null,
  status: 'running',
  prompt: 'hello',
  provider: 'claude-code',
  connectionMode: 'anthropic',
  modelId: null,
  triggerSource: 'user',
  agentDefinitionVersion: 3,
  idempotencyKey: null,
  idempotencyRequestHash: null,
  activeStreamId: null,
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  createdAt: new Date('2024-03-04T05:06:07.000Z'),
  updatedAt: new Date('2024-03-04T05:06:07.000Z'),
  startedAt: null,
  completedAt: null,
};

// Helper: drain a ReadableStream<Uint8Array> body into a list of SSE
// frames (splits on the blank-line terminator `\n\n`). Returns all
// frames accumulated until the stream closes.
async function readAllFrames(res: Response): Promise<string[]> {
  if (!res.body) throw new Error('Response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      frames.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');
    }
  }
  if (buffer.length > 0) frames.push(buffer);
  return frames;
}

// Helper: read frames up to `until` but break if reader fails (used for
// live-stream tests where the stream may stay open).
async function readFramesUntil(
  res: Response,
  until: (frame: string) => boolean
): Promise<string[]> {
  if (!res.body) throw new Error('Response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      frames.push(frame);
      buffer = buffer.slice(idx + 2);
      if (until(frame)) {
        reader.cancel().catch(() => undefined);
        return frames;
      }
      idx = buffer.indexOf('\n\n');
    }
  }
  return frames;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue(sessionAuth());
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockGetEvents.mockResolvedValue([]);
  mockIsTerminal.mockImplementation(
    (status: string) => status === 'completed' || status === 'failed'
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/v1/agents/:agentId/runs/:runId/events (auth + scope + ownership)', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope runs:read missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'runs:read');
  });

  it('400 when agentId is not a UUID', async () => {
    const res = await GET(req(), { params: params('not-uuid', RUN_ID) });
    expect(res.status).toBe(400);
  });

  it('400 when runId is not a UUID', async () => {
    const res = await GET(req(), { params: params(TASK_ID, 'bad') });
    expect(res.status).toBe(400);
  });

  it('400 when Last-Event-ID is non-numeric', async () => {
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    const res = await GET(req({ headers: { 'Last-Event-ID': 'not-a-number' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(400);
  });

  it('400 when Last-Event-ID is negative', async () => {
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    const res = await GET(req({ headers: { 'Last-Event-ID': '-1' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(400);
  });

  it('400 when Last-Event-ID is empty string', async () => {
    // `z.coerce.number()` would happily turn '' into 0 and silently
    // replay from the beginning. Rejecting at the route layer forces
    // callers to be explicit (omit header = full replay; send integer
    // = replay after N).
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    const res = await GET(req({ headers: { 'Last-Event-ID': '' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(400);
  });

  it('400 when Last-Event-ID is whitespace-only', async () => {
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    const res = await GET(req({ headers: { 'Last-Event-ID': '   ' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(400);
  });

  it('404 when run does not exist', async () => {
    mockGetById.mockResolvedValue(null);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(404);
  });

  it('404 when run belongs to a different Agent (cross-agent probing)', async () => {
    mockGetById.mockResolvedValue({
      ...SAMPLE_RUN,
      taskId: '00000000-0000-0000-0000-000000000999',
    });
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(404);
  });

  it('403 when caller lacks project access', async () => {
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(403);
  });
});

describe('GET /events — terminal run replay', () => {
  it('200 with text/event-stream + replays events then closes', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'completed' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValueOnce([
      { seq: 1, payload: { type: 'text-delta', delta: 'Hello' } },
      { seq: 2, payload: { type: 'text-delta', delta: ' world' } },
      { seq: 3, payload: { type: 'finish', reason: 'end_turn' } },
    ]);

    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');

    const frames = await readAllFrames(res);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBe(
      `id: 1\ndata: ${JSON.stringify({ type: 'text-delta', delta: 'Hello' })}`
    );
    expect(frames[1]).toBe(
      `id: 2\ndata: ${JSON.stringify({ type: 'text-delta', delta: ' world' })}`
    );
    expect(frames[2]).toBe(
      `id: 3\ndata: ${JSON.stringify({ type: 'finish', reason: 'end_turn' })}`
    );

    // getEvents called with currentSeq=0 (no Last-Event-ID). The store
    // filters seq > 0 → events 1,2,3. The initial replay is the only
    // call for a terminal run (no polling loop).
    expect(mockGetEvents).toHaveBeenCalledWith(RUN_ID, 0);
  });

  it('honours Last-Event-ID by starting replay after that seq', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'completed' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValueOnce([
      { seq: 5, payload: { type: 'text-delta', delta: 'resume' } },
      { seq: 6, payload: { type: 'finish' } },
    ]);

    const res = await GET(req({ headers: { 'Last-Event-ID': '4' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(200);

    const frames = await readAllFrames(res);
    expect(frames).toHaveLength(2);
    expect(frames[0].startsWith('id: 5\n')).toBe(true);
    expect(frames[1].startsWith('id: 6\n')).toBe(true);

    expect(mockGetEvents).toHaveBeenCalledWith(RUN_ID, 4);
  });

  it('terminal run with zero unseen events closes without frames', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'completed' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValueOnce([]);

    const res = await GET(req({ headers: { 'Last-Event-ID': '99' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(200);

    const frames = await readAllFrames(res);
    expect(frames).toHaveLength(0);
  });

  it('failed run replays fully and closes (no polling loop)', async () => {
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'failed' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValueOnce([
      { seq: 1, payload: { type: 'error', errorText: 'boom' } },
      {
        seq: 2,
        payload: { type: 'data-openrush-run-done', data: { status: 'failed', error: 'boom' } },
      },
    ]);

    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    const frames = await readAllFrames(res);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toContain('data-openrush-run-done');

    // Only the initial drain; no live-stream polling for terminal runs.
    expect(mockGetEvents).toHaveBeenCalledTimes(1);
  });
});

describe('GET /events — active run (polling)', () => {
  it('replays initial events then delivers live ones via polling', async () => {
    vi.useFakeTimers();

    mockGetById.mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'running' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);

    // Poll sequence:
    // 1. Initial drain (afterSeq=0) → returns seq 1
    // 2. Next tick → seq 2 appears
    // 3. Next tick → seq 3 appears + run transitions to completed
    mockGetEvents
      .mockResolvedValueOnce([{ seq: 1, payload: { type: 'text-delta', delta: 'a' } }]) // initial
      .mockResolvedValueOnce([{ seq: 2, payload: { type: 'text-delta', delta: 'b' } }]) // tick 1
      .mockResolvedValueOnce([{ seq: 3, payload: { type: 'finish' } }]) // tick 2 (pre-terminal)
      .mockResolvedValueOnce([]); // tick 2 (second drain after terminal detect)

    // status checks during polling
    mockGetById
      .mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'running' }) // tick 1
      .mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'completed' }); // tick 2

    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);

    // Kick off reader before advancing timers so the poll loop has a
    // consumer to enqueue into.
    const framesPromise = readAllFrames(res);

    // Let initial replay microtasks resolve.
    await vi.advanceTimersByTimeAsync(0);
    // Fire the first interval tick.
    await vi.advanceTimersByTimeAsync(500);
    // Fire the second interval tick (should detect terminal + close).
    await vi.advanceTimersByTimeAsync(500);

    const frames = await framesPromise;
    expect(frames.map((f) => f.split('\n')[0])).toEqual(['id: 1', 'id: 2', 'id: 3']);
  });

  it('tolerates empty poll responses between live events', async () => {
    vi.useFakeTimers();

    mockGetById.mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'running' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);

    mockGetEvents
      .mockResolvedValueOnce([]) // initial — no events yet
      .mockResolvedValueOnce([]) // tick 1
      .mockResolvedValueOnce([{ seq: 1, payload: { type: 'start' } }]) // tick 2 pre-check
      .mockResolvedValueOnce([]); // tick 2 post-check drain

    mockGetById
      .mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'running' }) // tick 1
      .mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'completed' }); // tick 2

    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    const framesPromise = readAllFrames(res);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500); // tick 1 (no new events)
    await vi.advanceTimersByTimeAsync(500); // tick 2 (seq 1 + terminal)

    const frames = await framesPromise;
    expect(frames).toHaveLength(1);
    expect(frames[0].startsWith('id: 1\n')).toBe(true);
  });

  it('closes the stream when client aborts (AbortSignal)', async () => {
    vi.useFakeTimers();

    mockGetById.mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'running' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValue([]);

    const controller = new AbortController();
    const res = await GET(req({ signal: controller.signal }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(200);

    const readAll = readFramesUntil(res, () => false);

    // Let start() run through to installing handlers.
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();

    // Reader should terminate once the stream closes.
    const frames = await readAll;
    expect(frames).toHaveLength(0);
  });

  it('does NOT start polling if client aborts before `start()` runs', async () => {
    // Regression test for sparring round-3 race: the abort listener
    // must be registered before any DB work so aborting in the window
    // between `GET()` returning and `start()` executing still cleans
    // up. With the fix, `closed` is pre-set and `start()` bails out
    // before installing the poll interval.
    vi.useFakeTimers();

    mockGetById.mockResolvedValueOnce({ ...SAMPLE_RUN, status: 'running' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValue([]);

    const controller = new AbortController();
    // Abort BEFORE GET is awaited — the signal is already aborted
    // when the route handler observes it, exercising the
    // `request.signal.aborted` short-circuit branch.
    controller.abort();

    const res = await GET(req({ signal: controller.signal }), {
      params: params(TASK_ID, RUN_ID),
    });
    expect(res.status).toBe(200);

    const frames = await readAllFrames(res);
    expect(frames).toHaveLength(0);

    // Advance past several poll intervals — if the bug regressed,
    // `tick()` would call getEvents repeatedly.
    const getEventsCallsBefore = mockGetEvents.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockGetEvents.mock.calls.length).toBe(getEventsCallsBefore);
  });

  it('stops polling when reader cancels the stream', async () => {
    // Regression test: `cancel()` on the ReadableStream (invoked e.g.
    // when a caller calls `body.cancel()`) must run `cleanup()` so the
    // setInterval is cleared. Without the fix the timer keeps running
    // indefinitely against an orphaned controller.
    vi.useFakeTimers();

    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'running' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValue([]);

    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);

    // Let start() install the poll interval.
    await vi.advanceTimersByTimeAsync(0);

    // Cancel the reader (simulates `body.cancel()` or the consumer
    // going away without touching the request signal).
    await res.body?.cancel();

    const callsAfterCancel = mockGetEvents.mock.calls.length;
    // Fire several tick intervals — cancelled stream should not
    // trigger more DB reads.
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockGetEvents.mock.calls.length).toBe(callsAfterCancel);
  });

  it('closes the stream without a body frame when initial replay throws', async () => {
    // Error path: we DO NOT emit a synthetic `data:` frame because
    // every SSE frame must carry `id: <seq>` per spec §事件协议, and
    // the DB failure means we have no seq to attach. Instead we close
    // the stream; the client's reconnect path resumes from its last
    // known `Last-Event-ID`.
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'running' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    const frames = await readAllFrames(res);
    expect(frames).toHaveLength(0);
  });
});

describe('GET /events — Last-Event-ID monotonicity', () => {
  it('does not re-emit events already delivered (reconnect with last id)', async () => {
    // Client previously received up to seq=2. On reconnect with
    // Last-Event-ID: 2 the server must replay seq > 2 only.
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'completed' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValueOnce([
      { seq: 3, payload: { type: 'text-delta', delta: 'c' } },
      { seq: 4, payload: { type: 'finish' } },
    ]);

    const res = await GET(req({ headers: { 'Last-Event-ID': '2' } }), {
      params: params(TASK_ID, RUN_ID),
    });
    const frames = await readAllFrames(res);
    expect(frames.map((f) => f.split('\n')[0])).toEqual(['id: 3', 'id: 4']);
    expect(mockGetEvents).toHaveBeenCalledWith(RUN_ID, 2);
  });
});

describe('GET /events — query cursor is NOT a reconnection vector', () => {
  it('ignores ?cursor / ?after / ?seq query params (header-only protocol)', async () => {
    // Spec §断线重连 pins the protocol to Last-Event-ID header ONLY.
    // This regression test locks that behaviour: query params masquerading
    // as cursors must NOT affect replay position. Without this guard,
    // future changes could silently introduce a dual-source protocol.
    mockGetById.mockResolvedValue({ ...SAMPLE_RUN, status: 'completed' });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockGetEvents.mockResolvedValueOnce([
      { seq: 1, payload: { type: 'text-delta', delta: 'a' } },
      { seq: 2, payload: { type: 'finish' } },
    ]);

    const url = `https://t/api/v1/agents/${TASK_ID}/runs/${RUN_ID}/events?cursor=99&after=50&seq=42`;
    const res = await GET(new Request(url), { params: params(TASK_ID, RUN_ID) });
    const frames = await readAllFrames(res);

    // Replay starts at seq=0 (no Last-Event-ID header), NOT at 99/50/42.
    expect(frames.map((f) => f.split('\n')[0])).toEqual(['id: 1', 'id: 2']);
    expect(mockGetEvents).toHaveBeenCalledWith(RUN_ID, 0);
  });
});
