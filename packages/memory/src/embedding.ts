/**
 * Embedding Provider 工厂
 *
 * 通过 fetch 调用 OpenAI 兼容的 embedding API，支持超时降级。
 * 不引入任何 SDK 依赖。
 */

import type { EmbeddingProvider } from './memory-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  /** Provider type. All use OpenAI-compatible API format. */
  provider: 'openai' | 'zhipu' | 'custom';
  apiKey: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout. Returns null if the timeout fires first.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

// ---------------------------------------------------------------------------
// Provider defaults
// ---------------------------------------------------------------------------

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string; dimensions: number }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'embedding-3',
    dimensions: 1024,
  },
  custom: {
    baseUrl: '',
    model: 'embedding',
    dimensions: 1024,
  },
};

const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EmbeddingProvider that calls an OpenAI-compatible embedding API.
 * All errors are gracefully degraded to empty arrays.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  const defaults = PROVIDER_DEFAULTS[config.provider] ?? PROVIDER_DEFAULTS.custom;
  const baseUrl = config.baseUrl ?? defaults.baseUrl;
  const model = config.model ?? defaults.model;
  const dimensions = config.dimensions ?? defaults.dimensions;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!baseUrl) {
    throw new Error('baseUrl is required for custom embedding provider');
  }

  return {
    dimensions,
    async embed(text: string): Promise<number[]> {
      if (!text) return [];
      try {
        const result = await withTimeout(
          fetch(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({ model, input: text }),
          }).then(async (res) => {
            if (!res.ok) return null;
            const json = (await res.json()) as {
              data?: Array<{ embedding?: number[] }>;
            };
            return json.data?.[0]?.embedding ?? null;
          }),
          timeoutMs
        );
        return result ?? [];
      } catch {
        return [];
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Null provider (graceful degradation)
// ---------------------------------------------------------------------------

/** Embedding provider that always returns empty embeddings. */
export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 0;
  async embed(_text: string): Promise<number[]> {
    return [];
  }
}
