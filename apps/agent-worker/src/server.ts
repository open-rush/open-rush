import { serve } from '@hono/node-server';
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { Hono } from 'hono';

const app = new Hono();

// Track active sessions for abort support
const activeSessions = new Map<string, AbortController>();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'agent-worker',
    activeRuns: activeSessions.size,
    timestamp: new Date().toISOString(),
  })
);

app.get('/status', (c) => c.json({ ready: true, activeRuns: activeSessions.size }));

app.post('/prompt', async (c) => {
  const body = await c.req.json();
  const { prompt, sessionId, messages, env, systemPrompt, modelId, allowedTools, maxTurns } =
    body as {
      prompt?: string;
      sessionId?: string;
      messages?: Array<{ role: string; content: string }>;
      env?: Record<string, string>;
      systemPrompt?: string;
      modelId?: string;
      allowedTools?: string[];
      maxTurns?: number;
    };

  // Support both prompt (direct) and messages (AI SDK useChat) formats
  const userPrompt = prompt ?? messages?.filter((m) => m.role === 'user').pop()?.content;
  if (!userPrompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const abortController = new AbortController();
  const sid = sessionId ?? crypto.randomUUID();
  activeSessions.set(sid, abortController);

  try {
    // Model from env: ANTHROPIC_MODEL (Bedrock ARN) or fallback
    const effectiveModelId = modelId ?? process.env.ANTHROPIC_MODEL ?? 'sonnet';
    const providerEnv: Record<string, string> = { ...(env ?? {}) };
    if (process.env.ANTHROPIC_BASE_URL) {
      providerEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
    }
    if (process.env.ANTHROPIC_API_KEY) {
      providerEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }

    const result = streamText({
      model: claudeCode(effectiveModelId, {
        permissionMode: 'bypassPermissions',
        maxTurns: maxTurns ?? 30,
        sessionId: sid,
        ...(allowedTools?.length ? { allowedTools } : {}),
        ...(Object.keys(providerEnv).length > 0 ? { env: providerEnv } : {}),
      }),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      prompt: userPrompt,
      abortSignal: abortController.signal,
    });

    // AI SDK text stream response — compatible with useChat on frontend
    const response = result.toTextStreamResponse();

    // Cleanup after stream ends
    Promise.resolve(result.response).then(
      () => activeSessions.delete(sid),
      () => activeSessions.delete(sid)
    );

    return response;
  } catch (err: unknown) {
    activeSessions.delete(sid);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

app.post('/abort', async (c) => {
  const { sessionId } = (await c.req.json()) as { sessionId?: string };
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }
  const controller = activeSessions.get(sessionId);
  if (controller) {
    controller.abort();
    activeSessions.delete(sessionId);
    return c.json({ aborted: true });
  }
  return c.json({ aborted: false, reason: 'session not found' }, 404);
});

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agent worker listening on http://localhost:${info.port}`);
});

export default app;
