/**
 * 纯脱敏工具模块
 * 仅包含可复用的敏感信息识别与掩码逻辑，不依赖任何 node-only 运行时能力。
 */

/**
 * 环境变量条目类型
 */
export interface EnvVarEntry {
  name: string;
  value: string;
  isSensitive: boolean;
}

/**
 * Tool output 脱敏结果
 */
export interface SanitizeToolOutputResult {
  /** 脱敏后的文本 */
  masked: string;
  /** 是否应当 suppress 原始输出（即内容包含了敏感信息） */
  shouldSuppress: boolean;
}

/**
 * Streaming Sanitizer 实例接口
 */
export interface StreamingSanitizer {
  /** 输入一个 chunk，返回可以安全输出的脱敏文本（可能为空字符串表示暂存中） */
  push(chunk: string): string;
  /** 流结束，flush 所有残留 buffer 并返回脱敏后的文本 */
  flush(): string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 敏感关键词列表（不区分大小写）
 */
const SENSITIVE_KEYWORDS = [
  'key',
  'secret',
  'password',
  'token',
  'credential',
  'auth',
  'private',
  'apikey',
  'api_key',
  'access',
  'cert',
  'certificate',
  'database_url',
  'postgresql_url',
  'mysql_url',
  'redis_url',
  'mongodb_url',
  'connection_string',
];

/**
 * 可能包含内嵌凭据的 URL 协议前缀
 */
const CREDENTIAL_URL_PROTOCOLS = [
  'postgresql://',
  'postgres://',
  'mysql://',
  'mongodb://',
  'mongodb+srv://',
  'redis://',
  'rediss://',
  'https://',
  'http://',
];

/**
 * 密码字段的关键词列表（用于 AI 生成的文本掩码）
 */
const PASSWORD_FIELD_KEYWORDS = ['密码', 'password', 'pwd', 'passwd', '口令'];

/**
 * 可能作为 secret 前缀的字符串集合（用于流式脱敏的 cross-chunk 检测）
 */
const SECRET_PREFIXES = CREDENTIAL_URL_PROTOCOLS.map((p) => p.toLowerCase());

// ---------------------------------------------------------------------------
// User env var whitelist
// ---------------------------------------------------------------------------

const userEnvVarNames = new Set<string>();

export function registerUserEnvVars(names: Iterable<string>): void {
  for (const name of names) userEnvVarNames.add(name);
}

export function clearUserEnvVars(): void {
  userEnvVarNames.clear();
}

export function isUserEnvVar(envName: string): boolean {
  return userEnvVarNames.has(envName);
}

// ---------------------------------------------------------------------------
// Core detection & masking
// ---------------------------------------------------------------------------

/**
 * 检查环境变量名是否包含敏感关键词
 */
export function isSensitiveEnvVar(envName: string): boolean {
  const lowerName = envName.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lowerName.includes(keyword));
}

/**
 * 对敏感值进行掩码处理
 * 保留前 4 位和后 3 位，中间用 ... 代替；≤10 位全部掩码
 */
export function maskSensitiveValue(value: string, envName: string): string {
  if (!isSensitiveEnvVar(envName)) {
    return value;
  }
  if (value.length <= 10) {
    return '********';
  }
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
}

/**
 * 掩码数据库连接字符串中的密码
 */
export function maskDatabaseConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.password) {
      return url;
    }
    parsed.password = '****';
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * 掩码文本中所有数据库连接字符串的密码
 * 同时处理 AI 生成的「密码: xxx」格式
 */
export function maskDatabaseConnectionStringsInText(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let result = text;

  for (const protocol of CREDENTIAL_URL_PROTOCOLS) {
    const protocolEscaped = protocol.replace(/[+]/g, '\\+');
    const pattern = new RegExp(`${protocolEscaped}[^\\s"'\`\\],)}>]+`, 'g');
    result = result.replace(pattern, (match) => maskDatabaseConnectionString(match));
  }

  for (const keyword of PASSWORD_FIELD_KEYWORDS) {
    const pattern = new RegExp(`([-*•]?\\s*${keyword}\\s*[:：]\\s*)(\`?)([^\`\\s\\n]+)(\`?)`, 'gi');
    result = result.replace(
      pattern,
      (match, prefix: string, openTick: string, pw: string, closeTick: string) => {
        if (pw === '****' || pw === '********') return match;
        return `${prefix}${openTick}****${closeTick}`;
      }
    );
  }

  return result;
}

/**
 * 掩码 JSON 文本中敏感字段的值
 */
export function maskSensitiveJsonFields(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  return text.replace(
    /"([^"]+)"\s*:\s*"([^"]+)"/g,
    (match, fieldName: string, fieldValue: string) => {
      if (isSensitiveEnvVar(fieldName)) {
        return `"${fieldName}":"${maskSensitiveValue(fieldValue, fieldName)}"`;
      }
      return match;
    }
  );
}

/**
 * 综合掩码文本中的敏感信息
 */
export function maskSensitiveInText(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }
  let result = maskDatabaseConnectionStringsInText(text);
  result = maskSensitiveJsonFields(result);
  return result;
}

// ---------------------------------------------------------------------------
// Output filtering
// ---------------------------------------------------------------------------

/**
 * 过滤输出中的敏感环境变量值
 */
export function filterSensitiveEnvOutput(output: string): string {
  if (!output || typeof output !== 'string') {
    return output;
  }

  const lines = output.split('\n');
  const filteredLines = lines.map((line) => {
    const envVarMatch = line.match(/^(?:(export\s+|declare\s+-x\s+))?([A-Z][A-Z0-9_]*)=(.+)$/);
    if (envVarMatch) {
      const [, prefix = '', key, rawValue] = envVarMatch;
      if (isSensitiveEnvVar(key)) {
        let value = rawValue;
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return `${prefix}${key}=${maskSensitiveValue(value, key)}`;
      }
    }
    return line;
  });

  const result = filteredLines.join('\n');
  return maskDatabaseConnectionStringsInText(result);
}

/**
 * 检查输出是否包含敏感环境变量
 */
export function containsSensitiveEnvVars(output: string): boolean {
  if (!output || typeof output !== 'string') {
    return false;
  }
  const lines = output.split('\n');
  for (const line of lines) {
    const envVarMatch = line.match(/^(?:export\s+|declare\s+-x\s+)?([A-Z][A-Z0-9_]*)=.+$/);
    if (envVarMatch && isSensitiveEnvVar(envVarMatch[1])) {
      return true;
    }
  }
  return false;
}

/**
 * 统一脱敏工具输出
 */
export function sanitizeToolOutput(output: string): SanitizeToolOutputResult {
  if (!output || typeof output !== 'string') {
    return { masked: output || '', shouldSuppress: false };
  }
  const afterEnvFilter = filterSensitiveEnvOutput(output);
  const masked = maskSensitiveJsonFields(afterEnvFilter);
  const shouldSuppress = masked !== output;
  return { masked, shouldSuppress };
}

// ---------------------------------------------------------------------------
// Streaming sanitizer
// ---------------------------------------------------------------------------

/**
 * 检查文本末尾是否可能是某个 secret 前缀的开头
 */
function findPotentialSecretPrefixLength(tail: string): number {
  const lowerTail = tail.toLowerCase();
  for (const prefix of SECRET_PREFIXES) {
    const maxLen = Math.min(lowerTail.length, prefix.length - 1);
    for (let n = maxLen; n >= 1; n--) {
      if (lowerTail.slice(-n) === prefix.slice(0, n)) {
        return n;
      }
    }
  }
  return 0;
}

/**
 * 创建有状态的 Streaming Sanitizer 实例
 * 内部维护 buffer，支持跨 chunk 检测被 TCP 分片拆分的 secret
 */
export function createStreamingSanitizer(): StreamingSanitizer {
  let buffer = '';

  return {
    push(chunk: string): string {
      buffer += chunk;
      const prefixLen = findPotentialSecretPrefixLength(buffer);
      if (prefixLen > 0) {
        const safePartLen = buffer.length - prefixLen;
        if (safePartLen <= 0) return '';
        const safePart = buffer.slice(0, safePartLen);
        buffer = buffer.slice(safePartLen);
        return maskSensitiveInText(safePart);
      }
      const output = maskSensitiveInText(buffer);
      buffer = '';
      return output;
    },
    flush(): string {
      if (buffer.length === 0) return '';
      const output = maskSensitiveInText(buffer);
      buffer = '';
      return output;
    },
  };
}
