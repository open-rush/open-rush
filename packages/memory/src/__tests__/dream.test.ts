import { describe, expect, it, vi } from 'vitest';
import type { DreamGateStore, DreamLock, DreamMemoryLoader } from '../dream.js';
import { DreamService, parseDreamActions } from '../dream.js';
import type { LlmProvider } from '../llm-extractor.js';
import type { EmbeddingProvider } from '../memory-store.js';
import type { MemoryEntry } from '../types.js';

// ---------------------------------------------------------------------------
// parseDreamActions
// ---------------------------------------------------------------------------

describe('parseDreamActions', () => {
  const ids = new Set(['mem-0', 'mem-1', 'mem-2', 'mem-3']);

  it('parses delete action', () => {
    const actions = parseDreamActions('[{"action":"delete","id":"mem-0"}]', ids);
    expect(actions).toEqual([{ action: 'delete', id: 'mem-0' }]);
  });

  it('parses merge action', () => {
    const text =
      '[{"action":"merge","keep_id":"mem-1","delete_ids":["mem-2"],"new_content":"merged"}]';
    const actions = parseDreamActions(text, ids);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      action: 'merge',
      keepId: 'mem-1',
      deleteIds: ['mem-2'],
      newContent: 'merged',
    });
  });

  it('parses update action', () => {
    const text = '[{"action":"update","id":"mem-3","new_content":"updated"}]';
    const actions = parseDreamActions(text, ids);
    expect(actions).toEqual([{ action: 'update', id: 'mem-3', newContent: 'updated' }]);
  });

  it('filters invalid IDs', () => {
    const actions = parseDreamActions('[{"action":"delete","id":"nonexistent"}]', ids);
    expect(actions).toEqual([]);
  });

  it('prevents duplicate ID participation', () => {
    const text = '[{"action":"delete","id":"mem-0"},{"action":"delete","id":"mem-0"}]';
    const actions = parseDreamActions(text, ids);
    expect(actions).toHaveLength(1);
  });

  it('removes keep_id from merge.deleteIds', () => {
    const text =
      '[{"action":"merge","keep_id":"mem-1","delete_ids":["mem-1","mem-2"],"new_content":"x"}]';
    const actions = parseDreamActions(text, ids);
    expect(actions).toHaveLength(1);
    if (actions[0].action === 'merge') {
      expect(actions[0].deleteIds).not.toContain('mem-1');
    }
  });

  it('returns empty for invalid JSON', () => {
    expect(parseDreamActions('not json', ids)).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(parseDreamActions('[]', ids)).toEqual([]);
  });

  it('handles markdown code fence', () => {
    const text = '```json\n[{"action":"delete","id":"mem-0"}]\n```';
    const actions = parseDreamActions(text, ids);
    expect(actions).toHaveLength(1);
  });

  it('filters empty new_content', () => {
    const text = '[{"action":"update","id":"mem-0","new_content":"  "}]';
    expect(parseDreamActions(text, ids)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DreamService
// ---------------------------------------------------------------------------

describe('DreamService', () => {
  function makeMemory(id: string): MemoryEntry {
    return {
      id,
      agentId: 'agent-1',
      projectId: 'proj-1',
      content: `Memory ${id}`,
      embedding: null,
      category: 'fact',
      importance: 0.5,
      metadata: {},
      createdAt: new Date(),
      accessedAt: new Date(),
    };
  }

  function createMocks(overrides?: {
    gateState?: { conversationsSinceDream: number; lastDreamAt: Date | null } | null;
    lockResult?: boolean;
    memories?: MemoryEntry[];
    llmResponse?: string;
  }) {
    const gateStore: DreamGateStore = {
      getGateState: vi
        .fn()
        .mockResolvedValue(
          'gateState' in (overrides ?? {})
            ? overrides?.gateState
            : { conversationsSinceDream: 10, lastDreamAt: null }
        ),
      resetGateState: vi.fn().mockResolvedValue(undefined),
      incrementConversationCount: vi.fn().mockResolvedValue(undefined),
    };
    const lock: DreamLock = {
      tryAcquire: vi.fn().mockResolvedValue(overrides?.lockResult ?? true),
    };
    const memoryLoader: DreamMemoryLoader = {
      loadMemories: vi
        .fn()
        .mockResolvedValue(
          overrides?.memories ?? Array.from({ length: 15 }, (_, i) => makeMemory(`mem-${i}`))
        ),
      deleteMemories: vi.fn().mockResolvedValue(undefined),
      updateMemoryContent: vi.fn().mockResolvedValue(undefined),
    };
    const llm: LlmProvider = {
      generateText: vi.fn().mockResolvedValue({ text: overrides?.llmResponse ?? '[]' }),
    };
    const embeddingProvider: EmbeddingProvider = {
      dimensions: 1024,
      embed: vi.fn().mockResolvedValue([]),
    };

    return { gateStore, lock, memoryLoader, llm, embeddingProvider };
  }

  it('skips when no gate state exists', async () => {
    const mocks = createMocks({ gateState: null });
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.dreamIfNeeded('agent-1', 'proj-1');
    expect(mocks.lock.tryAcquire).not.toHaveBeenCalled();
  });

  it('skips when conversations < minSessions', async () => {
    const mocks = createMocks({
      gateState: { conversationsSinceDream: 2, lastDreamAt: null },
    });
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.dreamIfNeeded('agent-1', 'proj-1');
    expect(mocks.lock.tryAcquire).not.toHaveBeenCalled();
  });

  it('skips when last dream was too recent', async () => {
    const mocks = createMocks({
      gateState: { conversationsSinceDream: 10, lastDreamAt: new Date() }, // just now
    });
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.dreamIfNeeded('agent-1', 'proj-1');
    expect(mocks.lock.tryAcquire).not.toHaveBeenCalled();
  });

  it('skips when lock acquisition fails', async () => {
    const mocks = createMocks({ lockResult: false });
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.dreamIfNeeded('agent-1', 'proj-1');
    expect(mocks.llm.generateText).not.toHaveBeenCalled();
  });

  it('skips LLM but resets counter when memory count < min', async () => {
    const mocks = createMocks({
      memories: [makeMemory('mem-0')], // only 1
    });
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.dreamIfNeeded('agent-1', 'proj-1');
    expect(mocks.llm.generateText).not.toHaveBeenCalled();
    expect(mocks.gateStore.resetGateState).toHaveBeenCalled();
  });

  it('executes dream with delete + update actions', async () => {
    const llmResponse = JSON.stringify([
      { action: 'delete', id: 'mem-0' },
      { action: 'update', id: 'mem-1', new_content: 'updated content' },
    ]);
    const mocks = createMocks({ llmResponse });
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.dreamIfNeeded('agent-1', 'proj-1');
    expect(mocks.memoryLoader.deleteMemories).toHaveBeenCalledWith(['mem-0'], 'agent-1', 'proj-1');
    expect(mocks.memoryLoader.updateMemoryContent).toHaveBeenCalledWith(
      'mem-1',
      'updated content',
      'agent-1',
      'proj-1'
    );
    expect(mocks.gateStore.resetGateState).toHaveBeenCalled();
  });

  it('handles LLM failure silently', async () => {
    const mocks = createMocks();
    (mocks.llm.generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM down'));
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    // Should not throw
    await service.dreamIfNeeded('agent-1', 'proj-1');
  });

  it('delegates incrementConversationCount to gateStore', async () => {
    const mocks = createMocks();
    const service = new DreamService(
      mocks.memoryLoader,
      mocks.gateStore,
      mocks.lock,
      mocks.llm,
      mocks.embeddingProvider
    );
    await service.incrementConversationCount('agent-1', 'proj-1');
    expect(mocks.gateStore.incrementConversationCount).toHaveBeenCalledWith('agent-1', 'proj-1');
  });
});
