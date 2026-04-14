import { describe, expect, it, vi } from 'vitest';
import { createMcpRuntime, jsonSchemaToZod, mcpSchemaToZod } from '../adapter.js';
import type { McpServerConfig } from '../types.js';

// ---------------------------------------------------------------------------
// jsonSchemaToZod
// ---------------------------------------------------------------------------

describe('jsonSchemaToZod', () => {
  it('converts string type', () => {
    const schema = jsonSchemaToZod({ type: 'string' });
    expect(schema.parse('hello')).toBe('hello');
  });

  it('converts string with description', () => {
    const schema = jsonSchemaToZod({ type: 'string', description: 'A name' });
    expect(schema.description).toBe('A name');
  });

  it('converts number type', () => {
    const schema = jsonSchemaToZod({ type: 'number' });
    expect(schema.parse(42)).toBe(42);
  });

  it('converts integer type', () => {
    const schema = jsonSchemaToZod({ type: 'integer' });
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse(3.14)).toThrow();
  });

  it('converts boolean type', () => {
    const schema = jsonSchemaToZod({ type: 'boolean' });
    expect(schema.parse(true)).toBe(true);
  });

  it('converts null type', () => {
    const schema = jsonSchemaToZod({ type: 'null' });
    expect(schema.parse(null)).toBeNull();
  });

  it('returns z.unknown() for unknown type', () => {
    const schema = jsonSchemaToZod({ type: 'custom' });
    expect(schema.parse('anything')).toBe('anything');
  });

  it('converts array type with items', () => {
    const schema = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('converts array type without items', () => {
    const schema = jsonSchemaToZod({ type: 'array' });
    expect(schema.parse([1, 'two'])).toEqual([1, 'two']);
  });

  it('converts object with properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(schema.parse({ name: 'test' })).toEqual({ name: 'test' });
  });

  it('handles optional fields', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    });
    expect(schema.parse({ name: 'test' })).toEqual({ name: 'test' });
  });

  it('converts object without properties', () => {
    const schema = jsonSchemaToZod({ type: 'object' });
    expect(schema.parse({ anything: 'goes' })).toEqual({ anything: 'goes' });
  });

  it('converts enum', () => {
    const schema = jsonSchemaToZod({ enum: ['red', 'green', 'blue'] });
    expect(schema.parse('red')).toBe('red');
    expect(() => schema.parse('purple')).toThrow();
  });

  it('converts anyOf to union', () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(schema.parse('hello')).toBe('hello');
    expect(schema.parse(42)).toBe(42);
  });

  it('converts oneOf to union', () => {
    const schema = jsonSchemaToZod({
      oneOf: [{ type: 'string' }, { type: 'boolean' }],
    });
    expect(schema.parse('yes')).toBe('yes');
    expect(schema.parse(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mcpSchemaToZod
// ---------------------------------------------------------------------------

describe('mcpSchemaToZod', () => {
  it('converts empty schema', () => {
    const schema = mcpSchemaToZod({ type: 'object' });
    expect(schema.parse({})).toEqual({});
  });

  it('converts schema with required fields', () => {
    const schema = mcpSchemaToZod({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
    expect(schema.parse({ query: 'test' })).toEqual({ query: 'test' });
    expect(() => schema.parse({})).toThrow();
  });

  it('converts schema with optional fields', () => {
    const schema = mcpSchemaToZod({
      type: 'object',
      properties: { limit: { type: 'number' } },
    });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ limit: 10 })).toEqual({ limit: 10 });
  });
});

// ---------------------------------------------------------------------------
// createMcpRuntime
// ---------------------------------------------------------------------------

// Mock the client module for runtime tests
vi.mock('../client.js', () => ({
  createMcpClient: vi.fn(),
}));

describe('createMcpRuntime', () => {
  it('returns empty result for empty configs', async () => {
    const runtime = createMcpRuntime();
    const result = await runtime.loadTools([]);
    expect(result.tools.size).toBe(0);
    expect(result.status).toHaveLength(0);
    await runtime.dispose();
  });

  it('skips disabled servers', async () => {
    const { createMcpClient } = await import('../client.js');
    const runtime = createMcpRuntime();
    const config: McpServerConfig = {
      id: 'test-1',
      name: 'disabled-server',
      transport: 'stdio',
      enabled: false,
      scope: 'project',
    };
    const result = await runtime.loadTools([config]);
    expect(result.tools.size).toBe(0);
    expect(createMcpClient).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it('handles connection failure gracefully', async () => {
    const { createMcpClient } = await import('../client.js');
    const mockClient = {
      connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn(),
      callTool: vi.fn(),
    };
    (createMcpClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);

    const runtime = createMcpRuntime();
    const config: McpServerConfig = {
      id: 'test-2',
      name: 'failing-server',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      scope: 'project',
    };
    const result = await runtime.loadTools([config]);
    expect(result.tools.size).toBe(0);
    expect(result.status).toHaveLength(1);
    expect(result.status[0].success).toBe(false);
    expect(result.status[0].error).toContain('Connection refused');
    await runtime.dispose();
  });

  it('loads tools from connected server', async () => {
    const { createMcpClient } = await import('../client.js');
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listTools: vi
        .fn()
        .mockResolvedValue([
          { name: 'search', description: 'Search the web', inputSchema: { type: 'object' } },
        ]),
      callTool: vi.fn(),
    };
    (createMcpClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);

    const runtime = createMcpRuntime();
    const config: McpServerConfig = {
      id: 'test-3',
      name: 'web',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      scope: 'project',
    };
    const result = await runtime.loadTools([config]);
    expect(result.tools.size).toBe(1);
    expect(result.tools.has('web__search')).toBe(true);
    expect(result.status[0].success).toBe(true);
    expect(result.status[0].toolCount).toBe(1);
    await runtime.dispose();
  });

  it('reports elapsed time', async () => {
    const { createMcpClient } = await import('../client.js');
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue([]),
      callTool: vi.fn(),
    };
    (createMcpClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);

    const runtime = createMcpRuntime();
    const config: McpServerConfig = {
      id: 'test-4',
      name: 'timer',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      scope: 'project',
    };
    const result = await runtime.loadTools([config]);
    expect(result.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.status[0].elapsedMs).toBeGreaterThanOrEqual(0);
    await runtime.dispose();
  });

  it('dispose disconnects all clients', async () => {
    const { createMcpClient } = await import('../client.js');
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue([]),
      callTool: vi.fn(),
    };
    (createMcpClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);

    const runtime = createMcpRuntime();
    const config: McpServerConfig = {
      id: 'test-5',
      name: 'server',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      scope: 'project',
    };
    await runtime.loadTools([config]);
    await runtime.dispose();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});
