import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to control env vars before importing the route handler
const originalEnv = { ...process.env };

describe('GET /api/health', () => {
  beforeEach(() => {
    // Clean env for each test
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function importAndCall() {
    // Re-import to pick up fresh env
    const mod = await import('../route.js');
    const response = await mod.GET(new Request('http://localhost/api/health'));
    return response.json();
  }

  it('returns ok status with timestamp and service name', async () => {
    const body = await importAndCall();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('lux-web');
    expect(body.timestamp).toBeDefined();
    // Verify timestamp is a valid ISO string
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('detects bedrock provider when CLAUDE_CODE_USE_BEDROCK=1', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    const body = await importAndCall();
    expect(body.provider).toBe('bedrock');
  });

  it('detects bedrock provider when CLAUDE_CODE_USE_BEDROCK=true', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = 'true';
    const body = await importAndCall();
    expect(body.provider).toBe('bedrock');
  });

  it('detects bedrock provider when CLAUDE_CODE_USE_BEDROCK=yes', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = 'yes';
    const body = await importAndCall();
    expect(body.provider).toBe('bedrock');
  });

  it('does not treat CLAUDE_CODE_USE_BEDROCK=0 as truthy', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '0';
    const body = await importAndCall();
    expect(body.provider).not.toBe('bedrock');
  });

  it('detects custom provider when ANTHROPIC_BASE_URL is set', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.api.com';
    const body = await importAndCall();
    expect(body.provider).toBe('custom');
  });

  it('detects anthropic provider when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const body = await importAndCall();
    expect(body.provider).toBe('anthropic');
  });

  it('returns unknown provider when no env vars configured', async () => {
    const body = await importAndCall();
    expect(body.provider).toBe('unknown');
  });

  it('bedrock takes precedence over custom and anthropic', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.ANTHROPIC_BASE_URL = 'https://custom.api.com';
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const body = await importAndCall();
    expect(body.provider).toBe('bedrock');
  });

  it('custom takes precedence over anthropic', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.api.com';
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const body = await importAndCall();
    expect(body.provider).toBe('custom');
  });
});
