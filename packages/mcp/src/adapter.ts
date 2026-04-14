/**
 * MCP Tool Adapter
 *
 * JSON Schema → Zod conversion + request-scoped MCP runtime management.
 * Does not depend on AI SDK — returns generic McpResolvedTool.
 */

import { type ZodTypeAny, z } from 'zod';
import { createMcpClient, type IMcpClient } from './client.js';
import type { McpClientOptions, McpServerConfig, McpTool } from './types.js';

// ---------------------------------------------------------------------------
// JSON Schema types
// ---------------------------------------------------------------------------

export interface McpJsonSchemaProperty {
  type?: string;
  description?: string;
  properties?: Record<string, McpJsonSchemaProperty>;
  required?: string[];
  items?: McpJsonSchemaProperty;
  enum?: string[];
  anyOf?: McpJsonSchemaProperty[];
  oneOf?: McpJsonSchemaProperty[];
}

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, McpJsonSchemaProperty>;
  required?: string[];
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod conversion
// ---------------------------------------------------------------------------

/** Recursively convert a JSON Schema property to a Zod type. */
export function jsonSchemaToZod(schema: McpJsonSchemaProperty): ZodTypeAny {
  // Handle anyOf/oneOf unions first
  if (schema.anyOf && schema.anyOf.length > 0) {
    const types = schema.anyOf.map(jsonSchemaToZod);
    if (types.length === 1) return types[0];
    return z.union(types as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }
  if (schema.oneOf && schema.oneOf.length > 0) {
    const types = schema.oneOf.map(jsonSchemaToZod);
    if (types.length === 1) return types[0];
    return z.union(types as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  // Handle enum
  if (schema.enum && schema.enum.length > 0) {
    return z.enum(schema.enum as [string, ...string[]]);
  }

  // Handle by type
  let zodType: ZodTypeAny;
  switch (schema.type) {
    case 'string':
      zodType = z.string();
      break;
    case 'number':
      zodType = z.number();
      break;
    case 'integer':
      zodType = z.number().int();
      break;
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'null':
      zodType = z.null();
      break;
    case 'array':
      zodType = schema.items ? z.array(jsonSchemaToZod(schema.items)) : z.array(z.unknown());
      break;
    case 'object': {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        zodType = z.record(z.unknown());
        break;
      }
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const propZod = jsonSchemaToZod(prop);
        shape[key] = required.has(key) ? propZod : propZod.optional();
      }
      zodType = z.object(shape);
      break;
    }
    default:
      zodType = z.unknown();
  }

  if (schema.description) {
    zodType = zodType.describe(schema.description);
  }

  return zodType;
}

/** Convert an MCP tool input schema to a Zod object. */
export function mcpSchemaToZod(
  inputSchema: McpToolInputSchema
): z.ZodObject<Record<string, ZodTypeAny>> {
  if (!inputSchema.properties || Object.keys(inputSchema.properties).length === 0) {
    return z.object({});
  }
  const required = new Set(inputSchema.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(inputSchema.properties)) {
    const propZod = jsonSchemaToZod(prop);
    shape[key] = required.has(key) ? propZod : propZod.optional();
  }
  return z.object(shape);
}

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

export interface McpConnectionStatus {
  serverName: string;
  success: boolean;
  toolCount: number;
  toolNames: string[];
  error?: string;
  elapsedMs: number;
}

export interface McpResolvedTool {
  /** Format: serverName__toolName */
  name: string;
  serverName: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface McpLoadResult {
  tools: Map<string, McpResolvedTool>;
  status: McpConnectionStatus[];
  totalElapsedMs: number;
}

export interface McpRuntime {
  loadTools(
    configs: McpServerConfig[],
    options?: { verbose?: boolean; timeout?: number }
  ): Promise<McpLoadResult>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

function convertTool(serverName: string, tool: McpTool, client: IMcpClient): McpResolvedTool {
  const qualifiedName = `${serverName}__${tool.name}`;
  const schema = mcpSchemaToZod((tool.inputSchema ?? { type: 'object' }) as McpToolInputSchema);

  return {
    name: qualifiedName,
    serverName,
    description: tool.description || tool.name,
    inputSchema: schema,
    execute: async (args: Record<string, unknown>) => {
      const result = await client.callTool(tool.name, args);
      if (result.isError) {
        const errorText = result.content?.map((c) => c.text ?? '').join('') ?? 'Unknown MCP error';
        throw new Error(errorText);
      }
      return result.content?.map((c) => c.text ?? '').join('') ?? '';
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

/** Create a request-scoped MCP runtime for parallel server connections. */
export function createMcpRuntime(): McpRuntime {
  const activeClients = new Map<string, IMcpClient>();

  return {
    async loadTools(
      configs: McpServerConfig[],
      options?: { verbose?: boolean; timeout?: number }
    ): Promise<McpLoadResult> {
      const start = Date.now();
      const tools = new Map<string, McpResolvedTool>();
      const status: McpConnectionStatus[] = [];

      const enabledConfigs = configs.filter((c) => c.enabled);

      const clientOptions: McpClientOptions = {
        timeout: options?.timeout,
        verbose: options?.verbose,
      };

      const results = await Promise.allSettled(
        enabledConfigs.map(async (config) => {
          const serverStart = Date.now();
          const client = createMcpClient(config, clientOptions);

          try {
            await client.connect();
            activeClients.set(config.name, client);

            const serverTools = await client.listTools();
            const resolved: McpResolvedTool[] = [];

            for (const tool of serverTools) {
              const converted = convertTool(config.name, tool, client);
              tools.set(converted.name, converted);
              resolved.push(converted);
            }

            return {
              serverName: config.name,
              success: true,
              toolCount: resolved.length,
              toolNames: resolved.map((t) => t.name),
              elapsedMs: Date.now() - serverStart,
            } satisfies McpConnectionStatus;
          } catch (err) {
            await client.disconnect().catch(() => {});
            return {
              serverName: config.name,
              success: false,
              toolCount: 0,
              toolNames: [],
              error: err instanceof Error ? err.message : String(err),
              elapsedMs: Date.now() - serverStart,
            } satisfies McpConnectionStatus;
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          status.push(result.value);
        }
      }

      return { tools, status, totalElapsedMs: Date.now() - start };
    },

    async dispose(): Promise<void> {
      const disconnects = Array.from(activeClients.values()).map((client) =>
        client.disconnect().catch(() => {})
      );
      await Promise.allSettled(disconnects);
      activeClients.clear();
    },
  };
}
