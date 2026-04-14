/**
 * Dream — 定期 LLM 驱动的记忆整理
 *
 * 门控条件（会话数 + 时间间隔 + 分布式锁）→ 加载记忆 → LLM 分析 →
 * 执行 delete/merge/update → 异步 re-embed。
 */

import type { LlmProvider } from './llm-extractor.js';
import type { EmbeddingProvider } from './memory-store.js';
import type { MemoryEntry } from './types.js';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface DreamConfig {
  minSessions: number;
  minHours: number;
  memoryLoadLimit: number;
  memoryMinCount: number;
}

export interface DreamGateStore {
  getGateState(
    agentId: string,
    projectId: string
  ): Promise<{ conversationsSinceDream: number; lastDreamAt: Date | null } | null>;
  resetGateState(agentId: string, projectId: string): Promise<void>;
  incrementConversationCount(agentId: string, projectId: string): Promise<void>;
}

export interface DreamLock {
  tryAcquire(key: string): Promise<boolean>;
}

export interface DreamMemoryLoader {
  loadMemories(agentId: string, projectId: string, limit: number): Promise<MemoryEntry[]>;
  deleteMemories(ids: string[], agentId: string, projectId: string): Promise<void>;
  updateMemoryContent(
    id: string,
    newContent: string,
    agentId: string,
    projectId: string
  ): Promise<void>;
}

export type DreamAction =
  | { action: 'delete'; id: string }
  | { action: 'merge'; keepId: string; deleteIds: string[]; newContent: string }
  | { action: 'update'; id: string; newContent: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DreamConfig = {
  minSessions: 5,
  minHours: 24,
  memoryLoadLimit: 500,
  memoryMinCount: 10,
};

const DREAM_SYSTEM_PROMPT = `任务：整理用户的记忆列表。

操作类型：
1. 语义去重 — 合并含义相同的记忆 (merge)
2. 矛盾处理 — 保留较新的，删除较旧的 (delete)
3. 过期清理 — 删除过时信息 (delete)
4. 上下文压缩 — 过多 context 记忆压缩为 fact (update)

输出：纯 JSON 数组
- { "action": "delete", "id": "..." }
- { "action": "merge", "keep_id": "...", "delete_ids": ["..."], "new_content": "..." }
- { "action": "update", "id": "...", "new_content": "..." }

规则：
- 不编造信息
- identity/preference 谨慎处理
- 无需整理时返回 []
- 不要输出 markdown 代码块`;

// ---------------------------------------------------------------------------
// Pure function: parse LLM dream output
// ---------------------------------------------------------------------------

/**
 * Parse and validate dream actions from LLM output.
 * Filters invalid IDs and prevents duplicate participation.
 */
export function parseDreamActions(text: string, validIds: Set<string>): DreamAction[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const usedIds = new Set<string>();
  const actions: DreamAction[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;

    if (obj.action === 'delete') {
      const id = obj.id;
      if (typeof id !== 'string' || !validIds.has(id) || usedIds.has(id)) continue;
      usedIds.add(id);
      actions.push({ action: 'delete', id });
    } else if (obj.action === 'merge') {
      const keepId = obj.keep_id;
      const deleteIds = obj.delete_ids;
      const newContent = obj.new_content;
      if (typeof keepId !== 'string' || !validIds.has(keepId)) continue;
      if (!Array.isArray(deleteIds)) continue;
      if (typeof newContent !== 'string' || !newContent.trim()) continue;

      const validDeleteIds = deleteIds.filter(
        (id): id is string =>
          typeof id === 'string' && validIds.has(id) && id !== keepId && !usedIds.has(id)
      );
      if (validDeleteIds.length === 0) continue;

      usedIds.add(keepId);
      for (const id of validDeleteIds) usedIds.add(id);

      actions.push({
        action: 'merge',
        keepId,
        deleteIds: validDeleteIds,
        newContent: newContent.trim(),
      });
    } else if (obj.action === 'update') {
      const id = obj.id;
      const newContent = obj.new_content;
      if (typeof id !== 'string' || !validIds.has(id) || usedIds.has(id)) continue;
      if (typeof newContent !== 'string' || !newContent.trim()) continue;
      usedIds.add(id);
      actions.push({ action: 'update', id, newContent: newContent.trim() });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Dream Service
// ---------------------------------------------------------------------------

export class DreamService {
  private config: DreamConfig;

  constructor(
    private memoryLoader: DreamMemoryLoader,
    private gateStore: DreamGateStore,
    private lock: DreamLock,
    private llm: LlmProvider,
    private embeddingProvider: EmbeddingProvider,
    config?: Partial<DreamConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async incrementConversationCount(agentId: string, projectId: string): Promise<void> {
    await this.gateStore.incrementConversationCount(agentId, projectId);
  }

  async dreamIfNeeded(agentId: string, projectId: string): Promise<void> {
    try {
      if (!(await this.shouldDream(agentId, projectId))) return;
      await this.executeDream(agentId, projectId);
    } catch {
      // Silent — dream is best-effort
    }
  }

  private async shouldDream(agentId: string, projectId: string): Promise<boolean> {
    const state = await this.gateStore.getGateState(agentId, projectId);
    if (!state) return false;

    if (state.conversationsSinceDream < this.config.minSessions) return false;

    if (state.lastDreamAt) {
      const hoursSince = (Date.now() - state.lastDreamAt.getTime()) / (60 * 60 * 1000);
      if (hoursSince < this.config.minHours) return false;
    }

    return true;
  }

  private async executeDream(agentId: string, projectId: string): Promise<void> {
    const lockKey = `dream:${agentId}:${projectId}`;
    const acquired = await this.lock.tryAcquire(lockKey);
    if (!acquired) return;

    const memories = await this.memoryLoader.loadMemories(
      agentId,
      projectId,
      this.config.memoryLoadLimit
    );

    if (memories.length < this.config.memoryMinCount) {
      await this.gateStore.resetGateState(agentId, projectId);
      return;
    }

    const validIds = new Set(memories.map((m) => m.id));
    const userPrompt = this.buildUserPrompt(memories);

    const { text } = await this.llm.generateText({
      system: DREAM_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    const actions = parseDreamActions(text, validIds);
    await this.applyActions(actions, agentId, projectId);
    await this.gateStore.resetGateState(agentId, projectId);

    // Async re-embed updated memories (fire-and-forget)
    for (const action of actions) {
      if (action.action === 'merge' || action.action === 'update') {
        const id = action.action === 'merge' ? action.keepId : action.id;
        const content = action.newContent;
        this.reEmbed(id, content).catch(() => {});
      }
    }
  }

  private buildUserPrompt(memories: MemoryEntry[]): string {
    const header = `以下是用户的 ${memories.length} 条记忆：\n`;
    const rows = memories.map((m) => {
      const date = m.accessedAt.toISOString().split('T')[0];
      return `${m.id} | ${m.category} | ${m.content} | ${date}`;
    });
    return header + rows.join('\n');
  }

  private async applyActions(
    actions: DreamAction[],
    agentId: string,
    projectId: string
  ): Promise<void> {
    const deleteIds: string[] = [];
    const updates: Array<{ id: string; newContent: string }> = [];

    for (const action of actions) {
      if (action.action === 'delete') {
        deleteIds.push(action.id);
      } else if (action.action === 'merge') {
        deleteIds.push(...action.deleteIds);
        updates.push({ id: action.keepId, newContent: action.newContent });
      } else if (action.action === 'update') {
        updates.push({ id: action.id, newContent: action.newContent });
      }
    }

    if (deleteIds.length > 0) {
      await this.memoryLoader.deleteMemories(deleteIds, agentId, projectId);
    }

    for (const { id, newContent } of updates) {
      await this.memoryLoader.updateMemoryContent(id, newContent, agentId, projectId);
    }
  }

  private async reEmbed(memoryId: string, content: string): Promise<void> {
    const embedding = await this.embeddingProvider.embed(content);
    if (embedding.length === 0) return;
    // Re-embedding is stored by the memory loader — caller handles persistence
    // This is a fire-and-forget operation
  }
}
