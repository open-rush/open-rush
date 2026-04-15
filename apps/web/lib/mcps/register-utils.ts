/**
 * MCP 注册工具函数
 *
 * 解析 MCP JSON 配置（Cursor/Claude Desktop 格式）为统一的注册数据。
 */

type McpTransportType = 'stdio' | 'sse' | 'http';

export interface ParsedMcpServer {
  name: string;
  displayName: string;
  transportType: McpTransportType;
  serverConfig: Record<string, unknown>;
}

/**
 * Parse MCP JSON configuration.
 *
 * Supports:
 * 1. { "mcpServers": { "name": { command, args, env } } }  (Cursor/Claude Desktop)
 * 2. { "name": { command, args, env } }  (single server)
 * 3. { "name": { url, headers } }  (HTTP/SSE)
 */
export function parseMcpJsonConfig(jsonStr: string): {
  servers: ParsedMcpServer[];
  error?: string;
} {
  if (!jsonStr.trim()) return { servers: [] };

  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { servers: [], error: '配置必须是一个 JSON 对象' };
    }

    const obj = hasOwnProp(parsed, 'mcpServers')
      ? (parsed.mcpServers as Record<string, unknown>)
      : (parsed as Record<string, unknown>);

    if (!isPlainRecord(obj)) {
      return { servers: [], error: 'mcpServers 必须是一个对象' };
    }

    return extractServersFromObject(obj);
  } catch {
    return { servers: [], error: 'JSON 格式错误，请检查语法' };
  }
}

/**
 * Parse a command line string into command + args.
 */
export function parseCommandLine(commandLine: string): {
  command: string;
  args: string[];
  inferredName: string;
} {
  const trimmed = commandLine.trim();
  if (!trimmed) return { command: '', args: [], inferredName: '' };

  const tokens = tokenize(trimmed);
  const command = tokens[0] || '';
  const args = tokens.slice(1);
  const inferredName = inferNameFromCommand(command, args);

  return { command, args, inferredName };
}

/**
 * Generate a slug-format ID from a name.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hasOwnProp(obj: unknown, key: string): boolean {
  return typeof obj === 'object' && obj !== null && key in obj;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function normalizeExplicitTransportType(typeValue: unknown): McpTransportType | null {
  if (typeValue === undefined || typeValue === null) return null;
  if (typeof typeValue !== 'string') return null;
  const normalized = typeValue.trim().toLowerCase();
  if (normalized === 'stdio') return 'stdio';
  if (normalized === 'sse') return 'sse';
  if (
    normalized === 'http' ||
    normalized === 'streamablehttp' ||
    normalized === 'streamable-http' ||
    normalized === 'streamable_http'
  )
    return 'http';
  return null;
}

function inferRemoteTransportType(urlStr: string): McpTransportType {
  return urlStr.includes('/sse') || urlStr.endsWith('/events') ? 'sse' : 'http';
}

function extractServersFromObject(obj: Record<string, unknown>): {
  servers: ParsedMcpServer[];
  error?: string;
} {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return { servers: [], error: '未检测到任何 MCP 服务器配置' };
  }

  const servers: ParsedMcpServer[] = [];

  for (const [name, config] of entries) {
    if (!isPlainRecord(config)) {
      return { servers: [], error: `服务器 "${name}" 的配置必须是对象` };
    }

    const explicitType = normalizeExplicitTransportType(config.type);
    if (hasOwnProp(config, 'type') && explicitType === null) {
      return { servers: [], error: `服务器 "${name}" 的 type 仅支持 stdio、sse、http` };
    }

    if (hasOwnProp(config, 'command') && !isNonEmptyString(config.command)) {
      return { servers: [], error: `服务器 "${name}" 的 command 必须是非空字符串` };
    }
    if (hasOwnProp(config, 'url') && !isNonEmptyString(config.url)) {
      return { servers: [], error: `服务器 "${name}" 的 url 必须是非空字符串` };
    }

    const hasValidCommand = isNonEmptyString(config.command);
    const hasValidUrl = isNonEmptyString(config.url);

    if (hasValidCommand && hasValidUrl) {
      return { servers: [], error: `服务器 "${name}" 不能同时包含 command 和 url` };
    }
    if (!hasValidCommand && !hasValidUrl) {
      return { servers: [], error: `服务器 "${name}" 缺少 command 或 url 字段` };
    }

    const transportType = hasValidCommand
      ? 'stdio'
      : explicitType === 'sse' || explicitType === 'http'
        ? explicitType
        : inferRemoteTransportType(String(config.url));

    if (explicitType && explicitType !== transportType) {
      return {
        servers: [],
        error: `服务器 "${name}" 的 type=${String(config.type)} 与实际配置不一致`,
      };
    }

    if (transportType === 'stdio') {
      if (hasOwnProp(config, 'url')) {
        return { servers: [], error: `服务器 "${name}" 的 stdio 配置不应包含 url` };
      }
      if (config.args !== undefined && !isStringArray(config.args)) {
        return { servers: [], error: `服务器 "${name}" 的 args 必须是字符串数组` };
      }
      if (config.env !== undefined && !isStringRecord(config.env)) {
        return { servers: [], error: `服务器 "${name}" 的 env 必须是字符串键值对对象` };
      }
    } else {
      if (hasOwnProp(config, 'command')) {
        return { servers: [], error: `服务器 "${name}" 的 ${transportType} 配置不应包含 command` };
      }
      try {
        const parsedUrl = new URL(String(config.url));
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return { servers: [], error: `服务器 "${name}" 的 url 必须是 http/https 地址` };
        }
      } catch {
        return { servers: [], error: `服务器 "${name}" 的 url 必须是合法 URL` };
      }
      if (config.headers !== undefined && !isStringRecord(config.headers)) {
        return { servers: [], error: `服务器 "${name}" 的 headers 必须是字符串键值对对象` };
      }
    }

    servers.push({
      name,
      displayName: name
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      transportType,
      serverConfig: config,
    });
  }

  return { servers };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const char of input) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function inferNameFromCommand(command: string, args: string[]): string {
  if (command === 'npx') {
    const packageArg = args.find(
      (a) => !a.startsWith('-') && (a.includes('/') || a.includes('@') || !a.startsWith('.'))
    );
    if (packageArg) return toSlug(packageArg.replace(/@[^/]*\//, '').replace(/@.*$/, ''));
  }
  if (command === 'uvx') {
    const packageArg = args.find((a) => !a.startsWith('-'));
    if (packageArg) return toSlug(packageArg);
  }
  if (command === 'node' || command === 'python' || command === 'python3') {
    const scriptArg = args.find((a) => !a.startsWith('-'));
    if (scriptArg) {
      const baseName = scriptArg.split('/').pop() || scriptArg;
      return toSlug(baseName.replace(/\.(js|ts|py|mjs|cjs)$/, ''));
    }
  }
  return toSlug(command);
}
