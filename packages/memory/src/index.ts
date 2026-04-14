export {
  type DreamAction,
  type DreamConfig,
  type DreamGateStore,
  type DreamLock,
  type DreamMemoryLoader,
  DreamService,
  parseDreamActions,
} from './dream.js';
export {
  createEmbeddingProvider,
  type EmbeddingConfig,
  NullEmbeddingProvider,
  withTimeout,
} from './embedding.js';
export { type ExtractionResult, type MemoryExtractor, SimpleExtractor } from './extractor.js';
export { applyMMR, applyTimeDecay, cosineSim } from './hybrid-search.js';
export {
  buildConversationText,
  LlmMemoryExtractor,
  type LlmProvider,
  type MessageLike,
  parseExtractionResult,
} from './llm-extractor.js';
export { type EmbeddingProvider, type MemoryDb, MemoryStore } from './memory-store.js';
export type {
  CreateMemoryInput,
  MemoryCategory,
  MemoryEntry,
  MemorySearchOptions,
  MemorySearchResult,
} from './types.js';
