import type { CreateSandboxOptions, SandboxInfo, SandboxProvider } from '@rush/sandbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import type { Checkpoint, CheckpointDb, CheckpointStorage } from '../run/checkpoint-service.js';
import { CheckpointService } from '../run/checkpoint-service.js';
import { RunOrchestrator } from '../run/run-orchestrator.js';
import type { CreateRunInput, Run, RunDb } from '../run/run-service.js';
import { RunService } from '../run/run-service.js';
import type { RunStatus } from '../run/run-state-machine.js';

class MockRunDb implements RunDb {
  private runs = new Map<string, Run>();
  async create(input: CreateRunInput): Promise<Run> {
    const run: Run = {
      id: `run-${Date.now()}`,
      agentId: input.agentId,
      parentRunId: input.parentRunId ?? null,
      status: 'queued',
      prompt: input.prompt,
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
    this.runs.set(run.id, run);
    return { ...run };
  }
  async findById(id: string): Promise<Run | null> {
    const r = this.runs.get(id);
    return r ? { ...r } : null;
  }
  async updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null> {
    const r = this.runs.get(id);
    if (!r) return null;
    r.status = status;
    r.updatedAt = new Date();
    if (extra) Object.assign(r, extra);
    return { ...r };
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
  async getInfo(): Promise<SandboxInfo | null> {
    return null;
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

class InMemoryCheckpointDb implements CheckpointDb {
  private checkpoints = new Map<string, Checkpoint>();

  async create(runId: string): Promise<Checkpoint> {
    const cp: Checkpoint = {
      id: `cp-${Date.now()}`,
      runId,
      status: 'in_progress',
      messagesSnapshotRef: null,
      workspaceDeltaRef: null,
      lastEventSeq: null,
      degradedRecovery: false,
      createdAt: new Date(),
    };
    this.checkpoints.set(cp.id, cp);
    return { ...cp };
  }

  async update(id: string, updates: Partial<Checkpoint>): Promise<Checkpoint | null> {
    const cp = this.checkpoints.get(id);
    if (!cp) return null;
    Object.assign(cp, updates);
    return { ...cp };
  }

  async findLatest(runId: string): Promise<Checkpoint | null> {
    for (const cp of this.checkpoints.values()) {
      if (cp.runId === runId) return { ...cp };
    }
    return null;
  }
}

class InMemoryStorage implements CheckpointStorage {
  private data = new Map<string, Buffer>();

  async uploadSnapshot(runId: string, data: Buffer): Promise<string> {
    const key = `checkpoints/${runId}/snapshot.json`;
    this.data.set(key, data);
    return key;
  }

  async downloadSnapshot(ref: string): Promise<Buffer> {
    const data = this.data.get(ref);
    if (!data) throw new Error('Not found');
    return data;
  }
}

function makeRun(id: string, parentRunId: string | null = null): Run {
  return {
    id,
    agentId: 'agent-1',
    parentRunId,
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

function mockSSEResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
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

describe('Run Recovery — Follow-up Runs', () => {
  it('restores context from parent checkpoint in follow-up run', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();
    const checkpointDb = new InMemoryCheckpointDb();
    const storage = new InMemoryStorage();
    const checkpointService = new CheckpointService(checkpointDb, storage);

    // Seed a parent run with checkpoint
    const parentRun = makeRun('parent-run');
    parentRun.status = 'completed';
    runDb.seed(parentRun);

    // Create checkpoint for parent
    const parentEvents = [
      {
        id: 'e1',
        runId: 'parent-run',
        eventType: 'text-delta',
        payload: { type: 'text-delta', content: 'Previous context here' },
        seq: 0,
        schemaVersion: '1',
        createdAt: new Date(),
      },
    ];
    await checkpointService.createCheckpoint(
      'parent-run',
      Buffer.from(JSON.stringify(parentEvents)),
      0
    );

    // Follow-up run
    const followUpRun = makeRun('follow-up-run', 'parent-run');
    runDb.seed(followUpRun);

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      checkpointService,
    });

    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('follow-up-run', 'continue', 'agent-1');

    // Verify the prompt sent to agent included restored context
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.prompt).toContain('Previous context here');
    expect(sentBody.prompt).toContain('continue');

    const finalRun = await runDb.findById('follow-up-run');
    expect(finalRun?.status).toBe('completed');
  });

  it('degrades to initial run when parent has no checkpoint', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();
    const checkpointService = new CheckpointService(
      new InMemoryCheckpointDb(),
      new InMemoryStorage()
    );

    const parentRun = makeRun('parent-no-cp');
    parentRun.status = 'completed';
    runDb.seed(parentRun);

    const followUpRun = makeRun('follow-up-no-cp', 'parent-no-cp');
    runDb.seed(followUpRun);

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      checkpointService,
    });

    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('follow-up-no-cp', 'test', 'agent-1');

    // Should still complete (degraded to initial)
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.prompt).toBe('test'); // No restored context prefix
    expect(sentBody.prompt).not.toContain('Restored from checkpoint');
  });

  it('initial run (no parentRunId) does not attempt restore', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();
    const checkpointService = new CheckpointService(
      new InMemoryCheckpointDb(),
      new InMemoryStorage()
    );

    const run = makeRun('initial-run');
    runDb.seed(run);

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      checkpointService,
    });

    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('initial-run', 'hello', 'agent-1');

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.prompt).toBe('hello');
    expect(sentBody.prompt).not.toContain('Restored from checkpoint');
  });

  it('degrades when checkpoint storage fails', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();
    const failingStorage: CheckpointStorage = {
      uploadSnapshot: () => Promise.reject(new Error('fail')),
      downloadSnapshot: () => Promise.reject(new Error('fail')),
    };
    const checkpointService = new CheckpointService(new InMemoryCheckpointDb(), failingStorage);

    // Seed parent with a checkpoint record (but storage will fail on download)
    const parentRun = makeRun('parent-fail');
    parentRun.status = 'completed';
    runDb.seed(parentRun);

    const followUpRun = makeRun('follow-up-fail', 'parent-fail');
    runDb.seed(followUpRun);

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      checkpointService,
    });

    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('follow-up-fail', 'retry', 'agent-1');

    // Should degrade and complete
    const finalRun = await runDb.findById('follow-up-fail');
    expect(finalRun?.status).toBe('completed');

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.prompt).toBe('retry'); // No checkpoint prefix
  });
});
