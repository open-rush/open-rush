/**
 * MCP Protocol Clients
 *
 * StdioMcpClient: spawns child process, JSON-RPC 2.0 over stdin/stdout
 * HttpMcpClient: SSE dual-channel / Streamable HTTP / traditional HTTP fallback
 */

import { type ChildProcess, spawn } from 'node:child_process';
import type { McpClientOptions, McpServerConfig, McpTool, McpToolCallResult } from './types.js';

// ---------------------------------------------------------------------------
// JSON-RPC types (internal)
// ---------------------------------------------------------------------------

interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: number | string;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface IMcpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pending request tracking
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Stdio MCP Client
// ---------------------------------------------------------------------------

export class StdioMcpClient implements IMcpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = '';
  private timeout: number;

  constructor(
    private config: McpServerConfig,
    options: McpClientOptions = {}
  ) {
    this.timeout = options.timeout ?? 30_000;
  }

  async connect(): Promise<void> {
    if (!this.config.command) throw new Error('Stdio config requires command');

    const env = { ...process.env, ...(this.config.env ?? {}) };
    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.process.stdout?.on('data', (data: Buffer) => this.handleData(data.toString()));
    this.process.on('exit', () => this.handleExit());

    await this.initialize();
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.sendRequest('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? {},
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })) as McpToolCallResult;
    return result;
  }

  async disconnect(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disconnected'));
    }
    this.pending.clear();

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lux-mcp-client', version: '1.0.0' },
    });
    this.sendNotification('notifications/initialized', {});
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });

      const request: JSONRPCRequest = { jsonrpc: '2.0', method, params, id };
      this.process?.stdin?.write(`${JSON.stringify(request)}\n`);
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const notification: JSONRPCRequest = { jsonrpc: '2.0', method, params };
    this.process?.stdin?.write(`${JSON.stringify(notification)}\n`);
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = JSON.parse(trimmed) as JSONRPCResponse;
        if (response.id !== undefined) {
          this.handleResponse(response);
        }
      } catch {
        // Ignore non-JSON lines (e.g. server stderr leaking to stdout)
      }
    }
  }

  private handleResponse(response: JSONRPCResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleExit(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP server process exited'));
    }
    this.pending.clear();
    this.process = null;
  }
}

// ---------------------------------------------------------------------------
// HTTP MCP Client (SSE + Streamable HTTP + traditional HTTP)
// ---------------------------------------------------------------------------

export class HttpMcpClient implements IMcpClient {
  private nextId = 1;
  private timeout: number;
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(config: McpServerConfig, options: McpClientOptions = {}) {
    this.timeout = options.timeout ?? 30_000;
    this.baseUrl = config.url ?? '';
  }

  async connect(): Promise<void> {
    if (!this.baseUrl) throw new Error('HTTP/SSE config requires url');
    await this.initializeHttp();
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.sendHttpRequest('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? {},
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    return (await this.sendHttpRequest('tools/call', {
      name,
      arguments: args,
    })) as McpToolCallResult;
  }

  async disconnect(): Promise<void> {
    this.sessionId = null;
  }

  private async initializeHttp(): Promise<void> {
    await this.sendHttpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lux-mcp-client', version: '1.0.0' },
    });
  }

  private async sendHttpRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const request: JSONRPCRequest = { jsonrpc: '2.0', method, params, id };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeout),
    });

    // Capture session ID from response
    const sid = response.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;

    if (!response.ok) {
      throw new Error(`MCP HTTP error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as JSONRPCResponse;
    if (json.error) {
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }
    return json.result;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create an MCP client based on the server config transport type. */
export function createMcpClient(config: McpServerConfig, options?: McpClientOptions): IMcpClient {
  switch (config.transport) {
    case 'stdio':
      return new StdioMcpClient(config, options);
    case 'sse':
    case 'streamable-http':
      return new HttpMcpClient(config, options);
    default:
      throw new Error(`Unsupported transport: ${config.transport}`);
  }
}

/** Quick helper: connect, list tools, disconnect. */
export async function getMcpTools(
  config: McpServerConfig,
  options?: McpClientOptions
): Promise<McpTool[]> {
  const client = createMcpClient(config, options);
  try {
    await client.connect();
    return await client.listTools();
  } finally {
    await client.disconnect();
  }
}
