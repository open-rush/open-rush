import { describe, expect, it } from 'vitest';
import { parseCommandLine, parseMcpJsonConfig, toSlug } from './register-utils';

// ---------------------------------------------------------------------------
// parseMcpJsonConfig
// ---------------------------------------------------------------------------

describe('parseMcpJsonConfig', () => {
  it('解析 Cursor/Claude Desktop mcpServers 格式', () => {
    const json = JSON.stringify({
      mcpServers: {
        'my-server': { command: 'npx', args: ['-y', '@scope/mcp-server'], env: { API_KEY: 'xxx' } },
      },
    });
    const result = parseMcpJsonConfig(json);
    expect(result.error).toBeUndefined();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe('my-server');
    expect(result.servers[0].transportType).toBe('stdio');
  });

  it('解析单个 server 格式', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({ 'swagger-mcp': { command: 'npx', args: ['-y', 'swagger-mcp@latest'] } })
    );
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].transportType).toBe('stdio');
  });

  it('解析 HTTP/SSE 配置', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({
        'api-server': {
          url: 'https://api.example.com/mcp',
          headers: { Authorization: 'Bearer xxx' },
        },
      })
    );
    expect(result.servers[0].transportType).toBe('http');
  });

  it('从 URL 模式检测 SSE transport', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({ 'sse-server': { url: 'https://api.example.com/sse' } })
    );
    expect(result.servers[0].transportType).toBe('sse');
  });

  it('解析多个 server', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({
        mcpServers: {
          'server-a': { command: 'npx', args: ['-y', 'pkg-a'] },
          'server-b': { url: 'https://api.example.com/mcp' },
        },
      })
    );
    expect(result.servers).toHaveLength(2);
  });

  it('一个 server 无效时整体失败', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({
        mcpServers: {
          valid: { command: 'npx', args: ['-y', 'ok-server'] },
          invalid: { args: ['-y', 'missing-command'] },
        },
      })
    );
    expect(result.servers).toHaveLength(0);
    expect(result.error).toContain('服务器 "invalid"');
  });

  it('command 非字符串时失败', () => {
    const result = parseMcpJsonConfig(JSON.stringify({ mcpServers: { broken: { command: 123 } } }));
    expect(result.error).toContain('command 必须是非空字符串');
  });

  it('type 与实际配置不一致时失败', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({
        mcpServers: { mismatch: { type: 'stdio', url: 'https://example.com/sse' } },
      })
    );
    expect(result.error).toContain('type=stdio 与实际配置不一致');
  });

  it('command 和 url 同时存在时失败', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({ mcpServers: { conflict: { command: 'npx', url: 'https://example.com' } } })
    );
    expect(result.error).toContain('不能同时包含 command 和 url');
  });

  it('无效 JSON 返回错误', () => {
    expect(parseMcpJsonConfig('not json').error).toBe('JSON 格式错误，请检查语法');
  });

  it('数组输入返回错误', () => {
    expect(parseMcpJsonConfig('[]').error).toBe('配置必须是一个 JSON 对象');
  });

  it('生成 displayName', () => {
    const result = parseMcpJsonConfig(
      JSON.stringify({ 'my-cool-server': { command: 'node', args: ['server.js'] } })
    );
    expect(result.servers[0].displayName).toBe('My Cool Server');
  });

  it('空字符串返回空 servers', () => {
    expect(parseMcpJsonConfig('').servers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseCommandLine
// ---------------------------------------------------------------------------

describe('parseCommandLine', () => {
  it('解析 npx 命令', () => {
    const result = parseCommandLine('npx -y @scope/mcp-server');
    expect(result.command).toBe('npx');
    expect(result.args).toEqual(['-y', '@scope/mcp-server']);
    expect(result.inferredName).toBe('mcp-server');
  });

  it('解析带版本的 npx', () => {
    const result = parseCommandLine('npx -y swagger-mcp@latest');
    expect(result.inferredName).toBe('swagger-mcp');
  });

  it('解析 node 命令', () => {
    const result = parseCommandLine('node /path/to/server.js');
    expect(result.inferredName).toBe('server');
  });

  it('解析 python 命令', () => {
    const result = parseCommandLine('python server.py');
    expect(result.inferredName).toBe('server');
  });

  it('解析 uvx 命令', () => {
    const result = parseCommandLine('uvx mcp-server-name');
    expect(result.inferredName).toBe('mcp-server-name');
  });

  it('空输入', () => {
    const result = parseCommandLine('');
    expect(result.command).toBe('');
    expect(result.args).toEqual([]);
  });

  it('处理引号参数', () => {
    const result = parseCommandLine('node "path with spaces/server.js"');
    expect(result.args).toEqual(['path with spaces/server.js']);
  });
});

// ---------------------------------------------------------------------------
// toSlug
// ---------------------------------------------------------------------------

describe('toSlug', () => {
  it('转小写', () => {
    expect(toSlug('MyServer')).toBe('myserver');
  });
  it('特殊字符替换为连字符', () => {
    expect(toSlug('my server@v2')).toBe('my-server-v2');
  });
  it('合并连续连字符', () => {
    expect(toSlug('my--server---name')).toBe('my-server-name');
  });
  it('去除首尾连字符', () => {
    expect(toSlug('-my-server-')).toBe('my-server');
  });
  it('截断到 64 字符', () => {
    expect(toSlug('a'.repeat(100)).length).toBeLessThanOrEqual(64);
  });
  it('空字符串', () => {
    expect(toSlug('')).toBe('');
  });
});
