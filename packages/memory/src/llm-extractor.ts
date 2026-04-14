/**
 * LLM 驱动的记忆提取
 *
 * 从对话中提取值得记住的信息（fact, preference, context, skill, decision）。
 * 通过 LlmProvider 接口抽象 LLM 调用，不引入 SDK 依赖。
 */

import type { ExtractionResult, MemoryExtractor } from './extractor.js';
import type { CreateMemoryInput, MemoryCategory } from './types.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Abstract LLM text generation provider */
export interface LlmProvider {
  generateText(options: { system: string; prompt: string }): Promise<{ text: string }>;
}

/** Flexible message format (supports various AI SDK message shapes) */
export interface MessageLike {
  role: string;
  content?: unknown;
  parts?: ReadonlyArray<{ type: string; text?: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set<MemoryCategory>([
  'fact',
  'preference',
  'context',
  'skill',
  'decision',
]);
const MAX_MESSAGES = 10;

const IMPORTANCE_MAP: Record<string, number> = {
  identity: 0.8,
  preference: 0.8,
  skill: 0.7,
  fact: 0.6,
  decision: 0.6,
  context: 0.4,
};

const EXTRACTION_SYSTEM_PROMPT = `从对话中提取值得记住的信息。

分类：
- fact: 客观事实、项目信息
- preference: 技术栈、工具偏好、工作风格
- context: 当次对话在做什么
- skill: 技术能力、经验水平
- decision: 重要技术/业务决策

输出：纯 JSON 数组，每个元素 { "content": "...", "category": "..." }
不要输出 markdown 代码块。如果没有值得记住的信息，输出空数组 []。`;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

function extractTextFromMessage(msg: MessageLike): string {
  if (msg.parts) {
    return msg.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n');
  }
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
  }
  return '';
}

/** Build conversation text from the last MAX_MESSAGES messages. */
export function buildConversationText(messages: MessageLike[]): string {
  const recent = messages.slice(-MAX_MESSAGES);
  return recent
    .map((msg) => {
      const text = extractTextFromMessage(msg);
      if (!text) return '';
      const role = msg.role === 'user' ? '用户' : 'AI';
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Parse LLM extraction output into validated memory entries. */
export function parseExtractionResult(
  text: string
): Array<{ content: string; category: MemoryCategory; importance: number }> {
  // Clean markdown code fences
  const cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is { content: string; category: string } => {
        if (typeof item !== 'object' || item === null) return false;
        const obj = item as Record<string, unknown>;
        if (typeof obj.content !== 'string' || !obj.content.trim()) return false;
        if (typeof obj.category !== 'string') return false;
        return VALID_CATEGORIES.has(obj.category as MemoryCategory);
      })
      .map((item) => ({
        content: item.content.trim(),
        category: item.category as MemoryCategory,
        importance: IMPORTANCE_MAP[item.category] ?? 0.5,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// LLM Memory Extractor
// ---------------------------------------------------------------------------

/**
 * LLM-based memory extractor. Replaces SimpleExtractor with semantic extraction.
 * All errors are silently handled (fire-and-forget pattern).
 */
export class LlmMemoryExtractor implements MemoryExtractor {
  constructor(private llm: LlmProvider) {}

  async extract(
    agentId: string,
    projectId: string,
    conversationText: string
  ): Promise<ExtractionResult> {
    if (!conversationText.trim()) {
      return { memories: [] };
    }

    try {
      const { text } = await this.llm.generateText({
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: conversationText,
      });

      const entries = parseExtractionResult(text);
      const memories: CreateMemoryInput[] = entries.map((e) => ({
        agentId,
        projectId,
        content: e.content,
        category: e.category,
        importance: e.importance,
      }));

      return { memories };
    } catch {
      return { memories: [] };
    }
  }
}
