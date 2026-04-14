import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '../llm-extractor.js';
import {
  buildConversationText,
  LlmMemoryExtractor,
  parseExtractionResult,
} from '../llm-extractor.js';

// ---------------------------------------------------------------------------
// buildConversationText
// ---------------------------------------------------------------------------

describe('buildConversationText', () => {
  it('formats user and assistant messages', () => {
    const text = buildConversationText([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
    expect(text).toContain('用户: Hello');
    expect(text).toContain('AI: Hi there');
  });

  it('takes only last 10 messages', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: 'user',
      content: `Message ${i}`,
    }));
    const text = buildConversationText(messages);
    expect(text).not.toContain('Message 0');
    expect(text).toContain('Message 14');
  });

  it('supports parts array format', () => {
    const text = buildConversationText([
      { role: 'user', parts: [{ type: 'text', text: 'Hello from parts' }] },
    ]);
    expect(text).toContain('Hello from parts');
  });

  it('skips empty messages', () => {
    const text = buildConversationText([
      { role: 'user', content: '' },
      { role: 'assistant', content: 'Valid' },
    ]);
    expect(text).not.toContain('用户:');
    expect(text).toContain('AI: Valid');
  });
});

// ---------------------------------------------------------------------------
// parseExtractionResult
// ---------------------------------------------------------------------------

describe('parseExtractionResult', () => {
  it('parses valid JSON array', () => {
    const text = '[{"content":"Uses TypeScript","category":"preference"}]';
    const result = parseExtractionResult(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Uses TypeScript');
    expect(result[0].category).toBe('preference');
    expect(result[0].importance).toBe(0.8);
  });

  it('handles markdown code fences', () => {
    const text = '```json\n[{"content":"fact","category":"fact"}]\n```';
    const result = parseExtractionResult(text);
    expect(result).toHaveLength(1);
  });

  it('filters invalid categories', () => {
    const text = '[{"content":"test","category":"invalid"}]';
    expect(parseExtractionResult(text)).toHaveLength(0);
  });

  it('filters empty content', () => {
    const text = '[{"content":"  ","category":"fact"}]';
    expect(parseExtractionResult(text)).toHaveLength(0);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseExtractionResult('not json')).toEqual([]);
  });

  it('returns empty for non-array JSON', () => {
    expect(parseExtractionResult('{"key":"value"}')).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(parseExtractionResult('[]')).toEqual([]);
  });

  it('assigns correct importance per category', () => {
    const text = `[
      {"content":"a","category":"preference"},
      {"content":"b","category":"fact"},
      {"content":"c","category":"context"},
      {"content":"d","category":"decision"},
      {"content":"e","category":"skill"}
    ]`;
    const result = parseExtractionResult(text);
    expect(result.find((r) => r.category === 'preference')?.importance).toBe(0.8);
    expect(result.find((r) => r.category === 'fact')?.importance).toBe(0.6);
    expect(result.find((r) => r.category === 'context')?.importance).toBe(0.4);
    expect(result.find((r) => r.category === 'decision')?.importance).toBe(0.6);
    expect(result.find((r) => r.category === 'skill')?.importance).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// LlmMemoryExtractor
// ---------------------------------------------------------------------------

describe('LlmMemoryExtractor', () => {
  function mockLlm(text: string): LlmProvider {
    return { generateText: vi.fn().mockResolvedValue({ text }) };
  }

  it('extracts memories from conversation', async () => {
    const llm = mockLlm('[{"content":"Prefers React","category":"preference"}]');
    const extractor = new LlmMemoryExtractor(llm);
    const result = await extractor.extract('agent-1', 'proj-1', '用户: I prefer React');
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].content).toBe('Prefers React');
    expect(result.memories[0].category).toBe('preference');
  });

  it('returns empty for empty conversation', async () => {
    const llm = mockLlm('[]');
    const extractor = new LlmMemoryExtractor(llm);
    const result = await extractor.extract('agent-1', 'proj-1', '');
    expect(result.memories).toEqual([]);
    expect(llm.generateText).not.toHaveBeenCalled();
  });

  it('returns empty when LLM fails', async () => {
    const llm: LlmProvider = {
      generateText: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const extractor = new LlmMemoryExtractor(llm);
    const result = await extractor.extract('agent-1', 'proj-1', 'Some conversation');
    expect(result.memories).toEqual([]);
  });

  it('returns empty when LLM returns invalid JSON', async () => {
    const llm = mockLlm('not json at all');
    const extractor = new LlmMemoryExtractor(llm);
    const result = await extractor.extract('agent-1', 'proj-1', 'Some conversation');
    expect(result.memories).toEqual([]);
  });
});
