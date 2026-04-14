/**
 * 安全工具模块
 * 提供危险命令检测、secret discovery 拦截和进程查询输出过滤。
 * 纯函数实现，无外部运行时依赖。
 */

import { isSensitiveEnvVar, isUserEnvVar } from './sanitizers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DangerousCommandResult {
  isDangerous: boolean;
  reason?: string;
  suggestion?: string;
}

export interface FilteredOutputResult {
  filtered: string;
  hasFiltered: boolean;
}

export interface DangerousCommandOptions {
  /** Ports to protect from being killed/queried. Defaults to [3000]. */
  protectedPorts?: number[];
  /** PIDs of service processes. If provided, `kill <pid>` will be blocked. */
  servicePIDs?: number[];
}

// ---------------------------------------------------------------------------
// Dangerous command detection
// ---------------------------------------------------------------------------

/**
 * 检测可能关闭平台服务的危险命令
 */
export function detectDangerousCommand(
  command: string,
  options: DangerousCommandOptions = {}
): DangerousCommandResult {
  const { protectedPorts = [3000], servicePIDs } = options;
  const normalizedCmd = command.toLowerCase().replace(/["']/g, '');

  // 1. 检测操作受保护端口
  for (const port of protectedPorts) {
    const portPattern = new RegExp(`(?:\\blsof\\b|\\bfuser\\b|\\bkill\\b).*:?${port}\\b`);
    if (portPattern.test(normalizedCmd)) {
      return {
        isDangerous: true,
        reason: `尝试操作受保护端口 ${port}，这会导致服务中断`,
        suggestion: '如果需要重启用户项目预览服务，请使用端口 8000-8002 而不是受保护端口',
      };
    }
  }

  // 2. 检测关闭所有 node 进程
  if (/(?:pkill|killall).*\bnode\b/.test(normalizedCmd)) {
    return {
      isDangerous: true,
      reason: '尝试关闭所有 node 进程，这会导致平台服务停止',
      suggestion:
        '如果需要重启用户项目预览服务，请使用精确的进程过滤（如 pkill -f "vite.*--port 8000"）',
    };
  }

  // 3. 检测 PM2 操作
  if (/pm2\s+(stop|delete|kill)/.test(normalizedCmd)) {
    return {
      isDangerous: true,
      reason: '尝试操作 PM2 进程管理器，这会导致服务停止',
      suggestion: '请不要操作 PM2 进程，如需重启预览服务请直接操作端口 8000-8002',
    };
  }

  // 4. 系统级危险操作
  if (/(?:shutdown|reboot|halt|poweroff)/.test(normalizedCmd)) {
    return {
      isDangerous: true,
      reason: '尝试执行系统关闭/重启命令',
      suggestion: '请不要执行系统级别的关机/重启命令',
    };
  }

  // 5. Next.js 开发服务器操作（允许用户项目端口）
  if (/(?:\bpkill\b|\bkill\b).*next.*dev/.test(normalizedCmd) && !/800[0-2]/.test(normalizedCmd)) {
    return {
      isDangerous: true,
      reason: '尝试关闭 Next.js 开发服务器，可能影响平台服务',
      suggestion: '如果需要重启用户项目预览服务，请明确指定端口 8000-8002',
    };
  }

  // 6. 进程查询可能泄露服务 PID
  if (/^ps\s+(aux|ef|axjf|-A|-e)/.test(normalizedCmd)) {
    const dangerousKeywords = ['node', 'next'];
    for (const keyword of dangerousKeywords) {
      const pattern = new RegExp(`\\|\\s*grep\\s+.*\\b${keyword}\\b`);
      if (pattern.test(normalizedCmd)) {
        return {
          isDangerous: true,
          reason: `检测到可能泄露服务 PID 的进程查询命令（包含关键词: ${keyword}）`,
          suggestion:
            '如果需要查询用户项目进程，请使用精确过滤：\n' +
            '  - ps aux | grep vite\n' +
            '  - ps aux | grep "port 8000"\n' +
            '  - lsof -ti:8000',
        };
      }
    }
  }

  // 7. PID kill 检测
  if (servicePIDs && servicePIDs.length > 0) {
    const killMatch = /\bkill\s+(?:-\d+\s+)?(.+)/.exec(normalizedCmd);
    if (killMatch) {
      const pidPattern = /\b(\d+)\b/g;
      let match: RegExpExecArray | null = pidPattern.exec(killMatch[1]);
      while (match !== null) {
        const pid = Number.parseInt(match[1], 10);
        if (servicePIDs.includes(pid)) {
          return {
            isDangerous: true,
            reason: `尝试关闭服务进程（PID: ${pid}），这会导致服务中断`,
            suggestion: '如果需要重启用户项目预览服务，请使用端口 8000-8002 的进程，而不是服务进程',
          };
        }
        match = pidPattern.exec(killMatch[1]);
      }
    }
  }

  return { isDangerous: false };
}

// ---------------------------------------------------------------------------
// Process query output filtering
// ---------------------------------------------------------------------------

/**
 * 过滤进程查询命令输出中的受保护服务信息
 */
export function filterProcessQueryOutput(
  output: string,
  command: string,
  options: { protectedPorts?: number[] } = {}
): FilteredOutputResult {
  if (!output) return { filtered: output, hasFiltered: false };

  const { protectedPorts = [3000] } = options;
  const normalizedCmd = command.toLowerCase();

  const isProcessQuery = /\b(ps|lsof|netstat|fuser|pgrep|pidof|ss)\b/.test(normalizedCmd);
  if (!isProcessQuery) {
    return { filtered: output, hasFiltered: false };
  }

  const lines = output.split('\n');
  const filteredLines = lines.filter((line) => {
    const normalizedLine = line.toLowerCase();

    let hasProtectedPort = false;
    for (const port of protectedPorts) {
      if (
        new RegExp(`:${port}\\b`).test(normalizedLine) ||
        new RegExp(`\\bport\\s+${port}\\b`).test(normalizedLine) ||
        new RegExp(`--port\\s*${port}\\b`).test(normalizedLine)
      ) {
        hasProtectedPort = true;
        break;
      }
    }

    if (!hasProtectedPort) return true;

    // 如果同时包含用户项目端口，保留该行
    return (
      /:800[0-2]\b/.test(normalizedLine) ||
      /\bport\s+800[0-2]\b/.test(normalizedLine) ||
      /--port\s*800[0-2]\b/.test(normalizedLine)
    );
  });

  const filtered = filteredLines.join('\n');
  return { filtered, hasFiltered: filtered !== output };
}

// ---------------------------------------------------------------------------
// Secret discovery detection
// ---------------------------------------------------------------------------

const ENV_FILE_SAFE_SUFFIXES = ['.example', '.template', '.sample', '.defaults'];

function splitShellCommandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function containsSensitiveEnvExpansion(segment: string): boolean {
  const envReferencePattern = /\$(?:\{)?([A-Z_][A-Z0-9_]*)(?:\})?/g;
  for (const match of segment.matchAll(envReferencePattern)) {
    const envName = match[1];
    if (envName && isSensitiveEnvVar(envName) && !isUserEnvVar(envName)) {
      return true;
    }
  }
  return false;
}

function isSensitiveEnvPrintSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!/^echo(\s|$)/.test(trimmed) && !/^printf(\s|$)/.test(trimmed)) {
    return false;
  }
  return containsSensitiveEnvExpansion(trimmed);
}

/**
 * 判断命令是否为高置信度的 secret discovery 命令
 */
export function isSecretDiscoveryCommand(command: string): boolean {
  const trimmed = command.trim();

  // 1. printenv
  if (/^printenv(\s|$)/.test(trimmed)) return true;

  // 2. env 独立命令（排除 env VAR=val cmd）
  if (/^env(\s|$)/.test(trimmed)) {
    const afterEnv = trimmed.slice(3).trimStart();
    if (afterEnv === '' || afterEnv.startsWith('|')) return true;
    if (/^[A-Z_][A-Z0-9_]*=/.test(afterEnv)) return false;
    return true;
  }

  // 3. set 独立命令
  if (/^set(\s*$|\s*\|)/.test(trimmed)) return true;

  // 4. cat .env* 文件（排除安全后缀）
  const catEnvMatch = trimmed.match(/^cat\s+(\S*\.env\S*)/);
  if (catEnvMatch) {
    const filePath = catEnvMatch[1];
    return !ENV_FILE_SAFE_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
  }

  // 5. echo/printf 直接展开敏感环境变量
  if (splitShellCommandSegments(trimmed).some(isSensitiveEnvPrintSegment)) {
    return true;
  }

  return false;
}
