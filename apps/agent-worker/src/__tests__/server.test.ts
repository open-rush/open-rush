import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));
vi.mock('ai-sdk-provider-claude-code', () => ({
  claudeCode: vi.fn(() => 'mock-model'),
}));
vi.mock('@hono/node-server', () => ({
  serve: vi.fn(),
}));

import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import app from '../server.js';

// Helper to parse JSON response body
async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('agent-worker server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // GET /health
  // ---------------------------------------------------------------
  describe('GET /health', () => {
    it('returns 200 with status ok, service name, activeRuns count, and timestamp', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('agent-worker');
      expect(typeof body.activeRuns).toBe('number');
      expect(body.timestamp).toBeDefined();
      // timestamp should be a valid ISO string
      expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // GET /status
  // ---------------------------------------------------------------
  describe('GET /status', () => {
    it('returns 200 with ready true and activeRuns count', async () => {
      const res = await app.request('/status');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.ready).toBe(true);
      expect(typeof body.activeRuns).toBe('number');
    });
  });

  // ---------------------------------------------------------------
  // POST /prompt
  // ---------------------------------------------------------------
  describe('POST /prompt', () => {
    function postPrompt(payload: Record<string, unknown>) {
      return app.request('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    function mockStreamTextSuccess() {
      const mockResult = {
        toUIMessageStreamResponse: vi.fn(() => new Response('streamed text')),
        response: Promise.resolve({}),
      };
      (streamText as Mock).mockReturnValue(mockResult);
      return mockResult;
    }

    it('returns 400 when neither prompt nor messages is provided', async () => {
      const res = await postPrompt({});
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('prompt is required');
    });

    it('returns 400 when messages array has no user messages', async () => {
      const res = await postPrompt({
        messages: [
          { role: 'assistant', content: 'hello' },
          { role: 'system', content: 'you are helpful' },
        ],
      });
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('prompt is required');
    });

    it('returns 400 when messages is an empty array', async () => {
      const res = await postPrompt({ messages: [] });
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('prompt is required');
    });

    it('calls streamText with the correct prompt when prompt string is provided', async () => {
      const mockResult = mockStreamTextSuccess();

      const res = await postPrompt({ prompt: 'write hello world' });
      expect(res.status).toBe(200);

      expect(streamText).toHaveBeenCalledOnce();
      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.prompt).toBe('write hello world');
      expect(callArgs.model).toBe('mock-model');
      expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal);
      expect(mockResult.toUIMessageStreamResponse).toHaveBeenCalledOnce();
    });

    it('extracts the last user message from messages array', async () => {
      mockStreamTextSuccess();

      const res = await postPrompt({
        messages: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'answer' },
          { role: 'user', content: 'follow up' },
        ],
      });
      expect(res.status).toBe(200);

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.prompt).toBe('follow up');
    });

    it('prompt takes precedence over messages when both are provided', async () => {
      mockStreamTextSuccess();

      const res = await postPrompt({
        prompt: 'direct prompt',
        messages: [{ role: 'user', content: 'from messages' }],
      });
      expect(res.status).toBe(200);

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.prompt).toBe('direct prompt');
    });

    it('passes systemPrompt as system option to streamText', async () => {
      mockStreamTextSuccess();

      await postPrompt({
        prompt: 'hello',
        systemPrompt: 'you are a coding assistant',
      });

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.system).toBe('you are a coding assistant');
    });

    it('does not include system option when systemPrompt is not provided', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello' });

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
    });

    it('passes custom modelId to claudeCode provider', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', modelId: 'opus' });

      expect(claudeCode).toHaveBeenCalledWith(
        'opus',
        expect.objectContaining({ permissionMode: 'bypassPermissions' })
      );
    });

    it('defaults modelId to sonnet when ANTHROPIC_MODEL env is not set', async () => {
      mockStreamTextSuccess();
      const original = process.env.ANTHROPIC_MODEL;
      delete process.env.ANTHROPIC_MODEL;

      await postPrompt({ prompt: 'hello' });

      expect(claudeCode).toHaveBeenCalledWith(
        'sonnet',
        expect.objectContaining({ permissionMode: 'bypassPermissions' })
      );

      // Restore
      if (original !== undefined) process.env.ANTHROPIC_MODEL = original;
    });

    it('passes maxTurns to claudeCode provider (defaults to 30)', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello' });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTurns: 30 })
      );
    });

    it('passes custom maxTurns to claudeCode provider', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', maxTurns: 10 });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTurns: 10 })
      );
    });

    it('passes allowedTools to claudeCode when provided', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', allowedTools: ['Bash', 'Read'] });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ allowedTools: ['Bash', 'Read'] })
      );
    });

    it('passes custom sessionId to claudeCode provider', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', sessionId: 'my-session-123' });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: 'my-session-123' })
      );
    });

    it('returns 500 with error message when streamText throws', async () => {
      (streamText as Mock).mockImplementation(() => {
        throw new Error('model unavailable');
      });

      const res = await postPrompt({ prompt: 'hello' });
      expect(res.status).toBe(500);

      const body = await json(res);
      expect(body.error).toBe('model unavailable');
    });

    it('returns 500 with stringified error when streamText throws a non-Error', async () => {
      (streamText as Mock).mockImplementation(() => {
        throw 'something went wrong';
      });

      const res = await postPrompt({ prompt: 'hello' });
      expect(res.status).toBe(500);

      const body = await json(res);
      expect(body.error).toBe('something went wrong');
    });
  });

  // ---------------------------------------------------------------
  // POST /abort
  // ---------------------------------------------------------------
  describe('POST /abort', () => {
    function postAbort(payload: Record<string, unknown>) {
      return app.request('/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    function postPrompt(payload: Record<string, unknown>) {
      return app.request('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    it('returns 400 when sessionId is missing', async () => {
      const res = await postAbort({});
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('sessionId is required');
    });

    it('returns 404 when sessionId is not found in active sessions', async () => {
      const res = await postAbort({ sessionId: 'nonexistent-session' });
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.aborted).toBe(false);
      expect(body.reason).toBe('session not found');
    });

    it('aborts an active session created by /prompt (round-trip)', async () => {
      // Mock streamText to return a result whose response never resolves,
      // keeping the session in activeSessions
      const mockResult = {
        toUIMessageStreamResponse: vi.fn(() => new Response('stream')),
        response: new Promise(() => {}), // never resolves
      };
      (streamText as Mock).mockReturnValue(mockResult);

      const sessionId = 'session-to-abort';

      // Create the session via /prompt
      const promptRes = await postPrompt({ prompt: 'hello', sessionId });
      expect(promptRes.status).toBe(200);

      // Verify the session is now tracked (activeRuns should be >= 1)
      const statusRes = await app.request('/health');
      const statusBody = await json(statusRes);
      expect(statusBody.activeRuns).toBeGreaterThanOrEqual(1);

      // Abort the session
      const abortRes = await postAbort({ sessionId });
      expect(abortRes.status).toBe(200);

      const abortBody = await json(abortRes);
      expect(abortBody.aborted).toBe(true);

      // After abort, the session should be removed — trying to abort again yields 404
      const abortAgainRes = await postAbort({ sessionId });
      expect(abortAgainRes.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------
  // 404 for unknown routes
  // ---------------------------------------------------------------
  describe('unknown routes', () => {
    it('returns 404 for unregistered paths', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
