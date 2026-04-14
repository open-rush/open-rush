export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unreachable';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  scope: 'global' | 'project' | 'user';
}

export interface McpServerState {
  config: McpServerConfig;
  status: McpServerStatus;
  lastHealthCheck: Date | null;
  error: string | null;
  pid: number | null;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpToolCallResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface McpClientOptions {
  timeout?: number;
  verbose?: boolean;
}
