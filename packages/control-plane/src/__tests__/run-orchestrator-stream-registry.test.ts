import type { CreateSandboxOptions, SandboxInfo, SandboxProvider } from '@rush/sandbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import { RunOrchestrator } from '../run/run-orchestrator.js';
import type { CreateRunInput, Run, RunDb } from '../run/run-service.js';
import { RunService } from '../run/run-service.js';
import type { RunStatus } from '../run/run-state-machine.js';

// ---------------------------------------------------------------------------
// Mock RunDb
// ---------------------------------------------------------------------------

class MockRunDb implements RunDb {
  private runs = new Map<string, Run>();

  async create(input: CreateRunInput): Promise<Run> {
    const run: Run = {
      id: `run-${Date.now()}`,
      agentId: input.agentId,
      parentRunId: input.parentRunId ?? null,
      status: 'queued',
      prompt: input.prompt,
      provider: input.provider ?? 'anthropic',
      connectionMode: input.connectionMode ?? 'sse',
      modelId: input.modelId ?? null,
      triggerSource: input.triggerSource ?? 'api',
      activeStreamId: null,
      retryCount: 0,
      maxRetries: 3,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return { ...run };
  }

  async findById(id: string): Promise<Run | null> {
    const run = this.runs.get(id);
    return run ? { ...run } : null;
  }

  async updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    run.status = status;
    run.updatedAt = new Date();
    if (extra) Object.assign(run, extra);
    return { ...run };
  }

  async listByAgent(): Promise<Run[]> {
    return [];
  }

  async findStuckRuns(): Promise<Run[]> {
    return [];
  }

  seed(run: Run): void {
    this.runs.set(run.id, { ...run });
  }
}

// ---------------------------------------------------------------------------
// Mock SandboxProvider
// ---------------------------------------------------------------------------

class MockSandboxProvider implements SandboxProvider {
  async create(_opts: CreateSandboxOptions): Promise<SandboxInfo> {
    return {
      id: 'sbx-1',
      status: 'running',
      endpoint: 'http://localhost:8787',
      previewUrl: null,
      createdAt: new Date(),
    };
  }
  async destroy(): Promise<void> {}
  async getInfo(id: string): Promise<SandboxInfo | null> {
    return {
      id,
      status: 'running',
      endpoint: 'http://localhost:8787',
      previewUrl: null,
      createdAt: new Date(),
    };
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async getEndpointUrl(_id: string, port: number): Promise<string | null> {
    return `http://localhost:${port}`;
  }
  async exec(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueuedRun(id: string): Run {
  return {
    id,
    agentId: 'agent-1',
    parentRunId: null,
    status: 'queued',
    prompt: 'test prompt',
    provider: 'anthropic',
    connectionMode: 'sse',
    modelId: null,
    triggerSource: 'api',
    activeStreamId: null,
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
}

function mockSSEResponse(events: Array<{ type: string; [k: string]: unknown }>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunOrchestrator activeStreamId', () => {
  let runDb: MockRunDb;
  let runService: RunService;
  let eventStore: InMemoryEventStore;
  let orchestrator: RunOrchestrator;

  beforeEach(() => {
    runDb = new MockRunDb();
    runService = new RunService(runDb);
    eventStore = new InMemoryEventStore();
    orchestrator = new RunOrchestrator({
      runService,
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
    });
  });

  it('completes run and persists activeStreamId if orchestrator sets it', async () => {
    const run = makeQueuedRun('run-sid-1');
    runDb.seed(run);

    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('run-sid-1', 'test', 'agent-1');

    const finalRun = await runDb.findById('run-sid-1');
    expect(finalRun?.status).toBe('completed');
  });

  it('persists events to EventStore during execution', async () => {
    const run = makeQueuedRun('run-events-1');
    runDb.seed(run);

    const events = [
      { type: 'text-delta', content: 'Hello' },
      { type: 'finish', reason: 'end_turn' },
    ];
    fetchMock.mockResolvedValueOnce(mockSSEResponse(events));

    await orchestrator.execute('run-events-1', 'test', 'agent-1');

    const stored = await eventStore.getEvents('run-events-1');
    expect(stored).toHaveLength(2);
    expect(stored[0].eventType).toBe('text-delta');
    expect(stored[1].eventType).toBe('finish');
  });
});

describe('RunService.setActiveStreamId', () => {
  it('updates activeStreamId without changing status', async () => {
    const runDb = new MockRunDb();
    const runService = new RunService(runDb);

    const run = makeQueuedRun('run-stream-id');
    run.status = 'running';
    runDb.seed(run);

    await runService.setActiveStreamId('run-stream-id', 'stream-abc-123');

    const updated = await runDb.findById('run-stream-id');
    expect(updated?.activeStreamId).toBe('stream-abc-123');
    expect(updated?.status).toBe('running');
  });

  it('throws when run does not exist', async () => {
    const runDb = new MockRunDb();
    const runService = new RunService(runDb);

    await expect(runService.setActiveStreamId('non-existent', 'stream-1')).rejects.toThrow(
      'Run not found'
    );
  });
});
