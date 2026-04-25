/**
 * Tests for POST/GET /api/v1/agents.
 *
 * The route orchestrates auth + Zod validation + project access, then hands
 * persistence work to AgentDefinitionService / RunService and direct drizzle
 * inserts against the `tasks` table. We mock:
 * - `@/lib/auth/unified-auth` — returns whatever AuthContext the test picks.
 * - `@/lib/api-utils` — `verifyProjectAccess` stub.
 * - `@open-rush/control-plane` — AgentDefinitionService + RunService classes
 *   backed by `vi.fn()` so we can programme per-test responses.
 * - `@open-rush/db` — a drizzle-ish `getDbClient` fake whose `select` /
 *   `insert` / `update` chains route back to vi.fn()s with the query params.
 * - `drizzle-orm` — a minimal helper shim so `and`/`eq`/etc. are recognised
 *   by the route at runtime (we never actually execute SQL here).
 *
 * Each test asserts the exact v1 envelope and HTTP status. Happy + auth +
 * validation + forbidden + conflict paths are all covered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockDefinitionGet,
  mockDefinitionGetByVersion,
  mockRunCreate,
  dbFake,
  FakeAgentDefinitionArchivedError,
  FakeAgentDefinitionNotFoundError,
  FakeAgentDefinitionVersionNotFoundError,
} = vi.hoisted(() => {
  class ArchivedErr extends Error {
    readonly agentId: string;
    readonly archivedAt: Date;
    constructor(agentId: string, archivedAt: Date) {
      super('archived');
      this.name = 'AgentDefinitionArchivedError';
      this.agentId = agentId;
      this.archivedAt = archivedAt;
    }
  }
  class NotFoundErr extends Error {
    readonly agentId: string;
    constructor(agentId: string) {
      super('not found');
      this.name = 'AgentDefinitionNotFoundError';
      this.agentId = agentId;
    }
  }
  class VersionNotFoundErr extends Error {
    readonly agentId: string;
    readonly version: number;
    constructor(agentId: string, version: number) {
      super('no version');
      this.name = 'AgentDefinitionVersionNotFoundError';
      this.agentId = agentId;
      this.version = version;
    }
  }

  // Programmable drizzle fake. Tests push scripted responses via
  // `dbFake.__select.mockReturnValueOnce(rows)` etc. Each `select()` chain
  // resolves to the NEXT queued rows — so tests can line up multiple
  // sequential selects (memberships → creator projects → tasks →
  // definitions). The chain supports the subset of drizzle fluent methods
  // our routes actually use: from / innerJoin / where / orderBy / limit.
  const selectSpy = vi.fn();
  const insertSpy = vi.fn();
  const updateSpy = vi.fn();

  function makeSelectChain(projArgs: unknown[]) {
    // Each terminal (limit / await) resolves to the result returned from
    // the spy for this particular chain. We capture one spy call per
    // chain so tests can use `mockReturnValueOnce` to script them in
    // order.
    const invocation = selectSpy({ kind: 'select', projArgs });
    const result = Array.isArray(invocation) ? invocation : [];

    // Terminal methods: `limit()` returns a Promise. For chains that don't
    // call limit (e.g. the GET paginator's `orderBy(...).limit(limit+1)`
    // path DOES call limit; the innerJoin path ends in `where`), the chain
    // also behaves as a promise-like through `Symbol.asyncIterator`-free
    // fallback on `orderBy` returning the result directly when `await`ed.
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
        // `await db.select().from(x).where(y)` (no limit) is used by the
        // memberships lookup → must resolve to the result directly. We
        // overlay Promise<> ergonomics without exposing a `then` prop on
        // the base shape (Biome forbids it).
        const asPromise = Promise.resolve(result) as Promise<unknown[]>;
        return Object.assign(asPromise, chain) as typeof chain & Promise<unknown[]>;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
    };
    return chain;
  }

  // `.update(x).set(y).where(z).returning()` is the new shape used by the
  // transaction path; `.update(x).set(y).where(z)` without `.returning()`
  // still resolves for the old code path (agents [id] route). The chain
  // records each invocation against `updateSpy` so tests can introspect
  // what was set, and `returning()` returns whatever queue the test
  // primed.
  function makeInsert(_table: unknown) {
    return {
      values: (values: unknown) => ({
        returning: () => {
          const invocation = insertSpy({ kind: 'insert', values });
          return Promise.resolve(Array.isArray(invocation) ? invocation : []);
        },
      }),
    };
  }

  function makeUpdate(_table: unknown) {
    return {
      set: (set: unknown) => ({
        where: (_pred: unknown) => {
          const invocation = updateSpy({ kind: 'update', set });
          return Object.assign(Promise.resolve(undefined), {
            returning: () => Promise.resolve(Array.isArray(invocation) ? invocation : []),
          });
        },
      }),
    };
  }

  // Inside `db.transaction(async (tx) => { ... })` drizzle gives the
  // callback a `tx` that behaves the same as the top-level DbClient.
  // Tests programme `insertSpy`/`updateSpy` exactly as they do for the
  // plain path; the same spies serve both cases.
  function makeTx() {
    return {
      select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
      insert: makeInsert,
      update: makeUpdate,
    };
  }

  const db = {
    __select: selectSpy,
    __insert: insertSpy,
    __update: updateSpy,
    select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
    insert: makeInsert,
    update: makeUpdate,
    transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
      return fn(makeTx());
    },
  };

  return {
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockDefinitionGet: vi.fn(),
    mockDefinitionGetByVersion: vi.fn(),
    mockRunCreate: vi.fn(),
    dbFake: db,
    FakeAgentDefinitionArchivedError: ArchivedErr,
    FakeAgentDefinitionNotFoundError: NotFoundErr,
    FakeAgentDefinitionVersionNotFoundError: VersionNotFoundErr,
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
  AgentDefinitionService: class {
    get = mockDefinitionGet;
    getByVersion = mockDefinitionGetByVersion;
  },
  AgentDefinitionArchivedError: FakeAgentDefinitionArchivedError,
  AgentDefinitionNotFoundError: FakeAgentDefinitionNotFoundError,
  AgentDefinitionVersionNotFoundError: FakeAgentDefinitionVersionNotFoundError,
  DrizzleRunDb: class {},
  RunService: class {
    createRun = mockRunCreate;
  },
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => dbFake,
  agents: { id: 'a.id', deliveryMode: 'a.dm', currentVersion: 'a.cv' },
  projectMembers: { projectId: 'pm.pid', userId: 'pm.uid' },
  projects: { id: 'p.id', createdBy: 'p.cb', deletedAt: 'p.deletedAt' },
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
  and: (...parts: unknown[]) => ({ type: 'and', parts }),
  or: (...parts: unknown[]) => ({ type: 'or', parts }),
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
  inArray: (c: unknown, v: unknown) => ({ type: 'inArray', c, v }),
  isNull: (c: unknown) => ({ type: 'isNull', c }),
  lt: (c: unknown, v: unknown) => ({ type: 'lt', c, v }),
  desc: (c: unknown) => ({ type: 'desc', c }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, POST } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const DEFINITION_ID = '00000000-0000-0000-0000-000000000aaa';
const OTHER_PROJECT_ID = '00000000-0000-0000-0000-0000000000bb';
const TASK_ID = '00000000-0000-0000-0000-000000000111';
const RUN_ID = '00000000-0000-0000-0000-000000000222';
const USER_ID = 'user-1';

function sessionAuth() {
  return { userId: USER_ID, scopes: ['*'], authType: 'session' as const };
}

function jsonReq(method: string, body?: unknown, url = 'https://t/api/v1/agents'): Request {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    definitionId: DEFINITION_ID,
    projectId: PROJECT_ID,
    mode: 'chat',
    ...overrides,
  };
}

const SAMPLE_DEFINITION = {
  id: DEFINITION_ID,
  projectId: PROJECT_ID,
  name: 'A',
  description: null,
  icon: null,
  providerType: 'claude-code',
  model: null,
  systemPrompt: null,
  appendSystemPrompt: null,
  allowedTools: [],
  skills: [],
  mcpServers: [],
  maxSteps: 10,
  deliveryMode: 'chat',
  config: null,
  currentVersion: 3,
  archivedAt: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
};

const SAMPLE_TASK_ROW = {
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue(sessionAuth());
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockDefinitionGet.mockResolvedValue(SAMPLE_DEFINITION);
  mockDefinitionGetByVersion.mockImplementation(async (_id: string, v: number) => ({
    ...SAMPLE_DEFINITION,
    currentVersion: v,
  }));
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/v1/agents', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('403 when scope agents:write missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agents:write');
  });

  it('400 for invalid JSON', async () => {
    const req = new Request('https://t/api/v1/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 when schema validation fails (non-uuid definitionId)', async () => {
    const res = await POST(jsonReq('POST', { ...validCreateBody(), definitionId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; issues?: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.issues)).toBe(true);
  });

  it('403 when caller has no access to the target project', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('404 when AgentDefinition does not exist', async () => {
    mockDefinitionGet.mockRejectedValue(new FakeAgentDefinitionNotFoundError(DEFINITION_ID));
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('404 when explicit definitionVersion does not exist', async () => {
    mockDefinitionGetByVersion.mockRejectedValue(
      new FakeAgentDefinitionVersionNotFoundError(DEFINITION_ID, 99)
    );
    const res = await POST(jsonReq('POST', validCreateBody({ definitionVersion: 99 })));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockDefinitionGetByVersion).toHaveBeenCalledWith(DEFINITION_ID, 99);
  });

  it('201 still allows creating Agent against an archived definition (spec §归档)', async () => {
    // spec/agent-definition-versioning.md §归档:
    //   "归档后仍可创建 Agent(兼容历史需求)" — route only logs a warning,
    //   does NOT 4xx.
    mockDefinitionGet.mockResolvedValue({
      ...SAMPLE_DEFINITION,
      archivedAt: new Date('2024-02-01T00:00:00.000Z'),
    });
    dbFake.__insert.mockImplementationOnce(() => [SAMPLE_TASK_ROW]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(201);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('archived definition'));
    warnSpy.mockRestore();
  });

  it('400 when AgentDefinition belongs to a different project', async () => {
    mockDefinitionGet.mockResolvedValue({ ...SAMPLE_DEFINITION, projectId: OTHER_PROJECT_ID });
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/does not belong/i);
  });

  it('400 when mode mismatches the definition deliveryMode', async () => {
    mockDefinitionGet.mockResolvedValue({ ...SAMPLE_DEFINITION, deliveryMode: 'workspace' });
    const res = await POST(jsonReq('POST', validCreateBody({ mode: 'chat' })));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/mode 'chat'/i);
  });

  it('201 creates Agent without initialInput (no Run created)', async () => {
    dbFake.__insert.mockImplementationOnce(({ values }: { values: Record<string, unknown> }) => [
      {
        ...SAMPLE_TASK_ROW,
        title: values.title ?? null,
        definitionVersion: values.definitionVersion,
      },
    ]);

    const res = await POST(jsonReq('POST', validCreateBody({ title: 'My Agent' })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        agent: { id: string; mode: string; definitionVersion: number };
        firstRunId: null | string;
      };
    };
    expect(body.data.firstRunId).toBeNull();
    expect(body.data.agent.id).toBe(TASK_ID);
    expect(body.data.agent.mode).toBe('chat');
    expect(body.data.agent.definitionVersion).toBe(3);
    expect(mockRunCreate).not.toHaveBeenCalled();
    // createdBy should come from auth context.
    expect(dbFake.__insert).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ createdBy: USER_ID, projectId: PROJECT_ID }),
      })
    );
  });

  it('201 binds explicit definitionVersion when provided', async () => {
    dbFake.__insert.mockImplementationOnce(({ values }: { values: Record<string, unknown> }) => [
      { ...SAMPLE_TASK_ROW, definitionVersion: values.definitionVersion },
    ]);

    const res = await POST(jsonReq('POST', validCreateBody({ definitionVersion: 2 })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { agent: { definitionVersion: number } } };
    expect(body.data.agent.definitionVersion).toBe(2);
    expect(mockDefinitionGetByVersion).toHaveBeenCalledWith(DEFINITION_ID, 2);
    expect(dbFake.__insert).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ definitionVersion: 2 }),
      })
    );
  });

  it('transaction bubbles up if createRun throws (caller sees 500 via rethrow)', async () => {
    // Verifies the new tx boundary propagates the failure instead of
    // leaving a half-made `tasks` row uncommitted. We can't assert real
    // rollback against the fake, but we can assert the route doesn't
    // swallow the error.
    dbFake.__insert.mockImplementationOnce(() => [SAMPLE_TASK_ROW]);
    mockRunCreate.mockRejectedValue(new Error('run insert boom'));
    await expect(POST(jsonReq('POST', validCreateBody({ initialInput: 'hello' })))).rejects.toThrow(
      'run insert boom'
    );
  });

  it('201 creates Agent + first Run when initialInput supplied', async () => {
    // Inside the transaction: insert → run create → update.returning().
    // The final task shape comes back from `.returning()` on the UPDATE,
    // so we prime both the insert and the update spies.
    dbFake.__insert.mockImplementationOnce(() => [SAMPLE_TASK_ROW]);
    mockRunCreate.mockResolvedValue({ id: RUN_ID, agentId: DEFINITION_ID });
    dbFake.__update.mockImplementationOnce(() => [
      { ...SAMPLE_TASK_ROW, activeRunId: RUN_ID, headRunId: RUN_ID },
    ]);

    const res = await POST(jsonReq('POST', validCreateBody({ initialInput: 'hello' })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { agent: { activeRunId: string; headRunId: string }; firstRunId: string };
    };
    expect(body.data.firstRunId).toBe(RUN_ID);
    expect(body.data.agent.activeRunId).toBe(RUN_ID);
    expect(body.data.agent.headRunId).toBe(RUN_ID);
    expect(mockRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: DEFINITION_ID,
        prompt: 'hello',
        taskId: TASK_ID,
        agentDefinitionVersion: 3,
      })
    );
    expect(dbFake.__update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ activeRunId: RUN_ID, headRunId: RUN_ID }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/agents', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(401);
  });

  it('403 when scope agents:read missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agents:read');
  });

  it('400 when query validation fails', async () => {
    const res = await GET(jsonReq('GET', undefined, 'https://t/api/v1/agents?limit=abc'));
    expect(res.status).toBe(400);
  });

  it('403 when projectId is set but caller has no access', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(
      jsonReq('GET', undefined, `https://t/api/v1/agents?projectId=${PROJECT_ID}`)
    );
    expect(res.status).toBe(403);
  });

  it('short-circuits to empty list when caller has no accessible projects', async () => {
    // No projectId filter → handler does memberships lookup → returns [].
    dbFake.__select.mockReturnValueOnce([]).mockReturnValueOnce([]);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('returns paginated envelope with ISO dates and populated mode', async () => {
    // 1 row returned when projectId filter is supplied.
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    // The subsequent select loads definitions for rendering.
    dbFake.__select.mockReturnValueOnce([
      { id: DEFINITION_ID, deliveryMode: 'chat', currentVersion: 3 },
    ]);
    const res = await GET(
      jsonReq('GET', undefined, `https://t/api/v1/agents?projectId=${PROJECT_ID}`)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; mode: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(TASK_ID);
    expect(body.data[0].mode).toBe('chat');
    expect(body.data[0].createdAt).toBe('2024-03-04T05:06:07.000Z');
    expect(body.nextCursor).toBeNull();
  });

  it('emits a nextCursor when the page is full (hasMore=true)', async () => {
    // Handler fetches limit+1 rows; we return 2 when default limit=50 is
    // overridden to 1 via the query.
    const row2 = {
      ...SAMPLE_TASK_ROW,
      id: '00000000-0000-0000-0000-000000000112',
      createdAt: new Date('2024-03-03T00:00:00.000Z'),
    };
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW, row2]);
    dbFake.__select.mockReturnValueOnce([
      { id: DEFINITION_ID, deliveryMode: 'chat', currentVersion: 3 },
    ]);
    const res = await GET(
      jsonReq('GET', undefined, `https://t/api/v1/agents?projectId=${PROJECT_ID}&limit=1`)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      nextCursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});
