export interface AgentBridgeConfig {
  agentWorkerUrl: string;
  requestTimeoutMs?: number;
}

export interface AgentBridgeResult {
  streamId: string;
  response: Response;
}

export class AgentBridge {
  constructor(private config: AgentBridgeConfig) {}

  async sendPrompt(
    prompt: string,
    options: {
      sessionId?: string;
      env?: Record<string, string>;
      requestId?: string;
      systemPrompt?: string;
      modelId?: string;
      allowedTools?: string[];
      maxTurns?: number;
    } = {}
  ): Promise<AgentBridgeResult> {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.requestId) {
      headers['x-request-id'] = options.requestId;
    }

    const response = await fetch(`${this.config.agentWorkerUrl}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        sessionId: options.sessionId,
        env: options.env,
        systemPrompt: options.systemPrompt,
        modelId: options.modelId,
        allowedTools: options.allowedTools,
        maxTurns: options.maxTurns,
        streamId,
      }),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 300_000),
    });

    if (!response.ok) {
      throw new Error(`Agent worker error: ${response.status} ${response.statusText}`);
    }

    return { streamId, response };
  }

  async abort(sessionId: string): Promise<void> {
    await fetch(`${this.config.agentWorkerUrl}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.agentWorkerUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
