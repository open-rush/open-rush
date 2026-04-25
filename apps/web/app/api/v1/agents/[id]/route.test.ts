/**
 * Tests for GET / DELETE /api/v1/agents/:id.
 *
 * The route loads the `tasks` row, verifies project membership, then either
 * renders a v1.Agent (GET) or soft-cancels + cancels the active run (DELETE).
 *
 * We mock the same surface as the parent route.test.ts so tests stay
 * hermetic: unified-auth, api-utils, control-plane (RunService), and a
 * drizzle-ish `getDbClient` fake whose `select`/`update` calls return
 * scripted responses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockCancelRun,
  dbFake,
  FakeRunAlreadyTerminalError,
  FakeRunCannotCancelError,
  FakeRunNotFoundError,
} = vi.hoisted(() => {
  class AlreadyTerminal extends Error {
    readonly status: string;
    constructor(_runId: string, status: string) {
      super('already terminal');
      this.name = 'RunAlreadyTerminalError';
      this.status = status;
    }
  }
  class CannotCancel extends Error {
    readonly status: string;
    constructor(_runId: string, status: string) {
      super('cannot cancel');
      this.name = 'RunCannotCancelError';
      this.status = status;
    }
  }
  class NotFound extends Error {
    constructor(runId: string) {
      super(`not found ${runId}`);
      this.name = 'RunNotFoundError';
    }
  }

  const selectSpy = vi.fn();
  const updateSpy = vi.fn();
  function makeSelectChain(projArgs: unknown[]) {
    const invocation = selectSpy({ kind: 'select', projArgs });
    const result = Array.isArray(invocation) ? invocation : [];
    const chain: {
      from: (t: unknown) => typeof chain;
      innerJoin: (t: unknown, on: unknown) => typeof chain;
      where: (p: unknown) => typeof chain & Promise<unknown[]>;
      orderBy: (...o: unknown[]) => typeof chain;
      limit: (n: number) => Promise<unknown[]>;
    } = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => {
        const asPromise = Promise.resolve(result) as Promise<unknown[]>;
        return Object.assign(asPromise, chain) as typeof chain & Promise<unknown[]>;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
    };
    return chain;
  }
  const db = {
    __select: selectSpy,
    __update: updateSpy,
    select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
    update: (_table: unknown) => ({
      set: (set: unknown) => ({
        where: (_pred: unknown) => {
          updateSpy({ kind: 'update', set });
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  return {
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockCancelRun: vi.fn(),
    dbFake: db,
    FakeRunAlreadyTerminalError: AlreadyTerminal,
    FakeRunCannotCancelError: CannotCancel,
    FakeRunNotFoundError: NotFound,
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
    cancelRun = mockCancelRun;
  },
  RunAlreadyTerminalError: FakeRunAlreadyTerminalError,
  RunCannotCancelError: FakeRunCannotCancelError,
  RunNotFoundError: FakeRunNotFoundError,
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => dbFake,
  agents: { id: 'a.id', deliveryMode: 'a.dm', currentVersion: 'a.cv' },
  tasks: {
    id: 't.id',
    projectId: 't.pid',
    agentId: 't.aid',
    title: 't.title',
    status: 't.status',
    activeRunId: 't.arid',
    headRunId: 't.hrid',
    createdBy: 't.cb',
    definitionVersion: 't.dv',
    createdAt: 't.createdAt',
    updatedAt: 't.updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { DELETE, GET } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const DEFINITION_ID = '00000000-0000-0000-0000-000000000aaa';
const TASK_ID = '00000000-0000-0000-0000-000000000111';
const RUN_ID = '00000000-0000-0000-0000-000000000222';
const USER_ID = 'user-1';

function sessionAuth() {
  return { userId: USER_ID, scopes: ['*'], authType: 'session' as const };
}

function jsonReq(method: string, url = `https://t/api/v1/agents/${TASK_ID}`): Request {
  return new Request(url, { method });
}

const SAMPLE_TASK = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  agentId: DEFINITION_ID,
  createdBy: USER_ID,
  title: null,
  status: 'active',
  handoffSummary: null,
  headRunId: null,
  activeRunId: null,
  definitionVersion: 3,
  createdAt: new Date('2024-03-04T05:06:07.000Z'),
  updatedAt: new Date('2024-03-04T05:06:07.000Z'),
};

const SAMPLE_DEFINITION = {
  id: DEFINITION_ID,
  deliveryMode: 'chat',
  currentVersion: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue(sessionAuth());
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
});

async function paramsOf(id: string) {
  return Promise.resolve({ id });
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/agents/:id', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope agents:read missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agents:read');
  });

  it('400 when id param is not a UUID', async () => {
    const res = await GET(jsonReq('GET'), { params: paramsOf('not-a-uuid') });
    expect(res.status).toBe(400);
  });

  it('404 when task row is missing', async () => {
    dbFake.__select.mockReturnValueOnce([]);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('403 when caller lacks project access (row exists but not yours)', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
  });

  it('404 when backing AgentDefinition is missing', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK]).mockReturnValueOnce([]);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/backing AgentDefinition/i);
  });

  it('200 returns v1.Agent with ISO dates on success', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK]).mockReturnValueOnce([SAMPLE_DEFINITION]);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; definitionId: string; mode: string; createdAt: string };
    };
    expect(body.data.id).toBe(TASK_ID);
    expect(body.data.definitionId).toBe(DEFINITION_ID);
    expect(body.data.mode).toBe('chat');
    expect(body.data.createdAt).toBe('2024-03-04T05:06:07.000Z');
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/agents/:id', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope agents:write missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agents:write');
  });

  it('404 when task row is missing', async () => {
    dbFake.__select.mockReturnValueOnce([]);
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(404);
  });

  it('403 when caller lacks project access', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
  });

  it('200 soft-cancels active Agent with no active run', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK]);
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; status: string; cancelledRunId: string | null };
    };
    expect(body.data.id).toBe(TASK_ID);
    expect(body.data.status).toBe('cancelled');
    expect(body.data.cancelledRunId).toBeNull();
    expect(mockCancelRun).not.toHaveBeenCalled();
    // tasks.status bumped to cancelled.
    expect(dbFake.__update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ status: 'cancelled', activeRunId: null }),
      })
    );
  });

  it('200 cancels active run + soft-deletes the Agent', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK, activeRunId: RUN_ID }]);
    mockCancelRun.mockResolvedValue({ id: RUN_ID, status: 'failed' });
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { cancelledRunId: string | null };
    };
    expect(body.data.cancelledRunId).toBe(RUN_ID);
    expect(mockCancelRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('200 soft-degrades when active run is already terminal', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK, activeRunId: RUN_ID }]);
    mockCancelRun.mockRejectedValue(new FakeRunAlreadyTerminalError(RUN_ID, 'completed'));
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; cancelledRunId: string | null };
    };
    expect(body.data.status).toBe('cancelled');
    expect(body.data.cancelledRunId).toBeNull();
    // Task row was still soft-cancelled.
    expect(dbFake.__update).toHaveBeenCalled();
  });

  it('200 soft-degrades when active run has been deleted (RunNotFoundError)', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK, activeRunId: RUN_ID }]);
    mockCancelRun.mockRejectedValue(new FakeRunNotFoundError(RUN_ID));
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { cancelledRunId: string | null };
    };
    expect(body.data.cancelledRunId).toBeNull();
  });

  it('400 VALIDATION_ERROR when run is in finalizing_retryable_failed', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK, activeRunId: RUN_ID }]);
    mockCancelRun.mockRejectedValue(
      new FakeRunCannotCancelError(RUN_ID, 'finalizing_retryable_failed')
    );
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.hint).toMatch(/retry/i);
    // Task row was NOT soft-cancelled on this failure path.
    expect(dbFake.__update).not.toHaveBeenCalled();
  });

  it('DELETE is idempotent: already-cancelled Agent returns 200 without re-cancelling', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK, status: 'cancelled' }]);
    const res = await DELETE(jsonReq('DELETE'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; cancelledRunId: string | null };
    };
    expect(body.data.status).toBe('cancelled');
    // No update was issued.
    expect(dbFake.__update).not.toHaveBeenCalled();
    expect(mockCancelRun).not.toHaveBeenCalled();
  });
});
