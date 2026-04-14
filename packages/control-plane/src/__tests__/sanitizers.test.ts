import { afterEach, describe, expect, it } from 'vitest';
import {
  clearUserEnvVars,
  containsSensitiveEnvVars,
  createStreamingSanitizer,
  filterSensitiveEnvOutput,
  isSensitiveEnvVar,
  isUserEnvVar,
  maskDatabaseConnectionString,
  maskDatabaseConnectionStringsInText,
  maskSensitiveJsonFields,
  maskSensitiveValue,
  registerUserEnvVars,
  sanitizeToolOutput,
} from '../vault/sanitizers.js';

afterEach(() => {
  clearUserEnvVars();
});

// ---------------------------------------------------------------------------
// isSensitiveEnvVar
// ---------------------------------------------------------------------------

describe('isSensitiveEnvVar', () => {
  it.each([
    'API_KEY',
    'SECRET_KEY',
    'DATABASE_PASSWORD',
    'AUTH_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'PRIVATE_KEY',
    'REDIS_URL',
    'MONGODB_URL',
    'CONNECTION_STRING',
    'CERT_FILE',
  ])('detects %s as sensitive', (name) => {
    expect(isSensitiveEnvVar(name)).toBe(true);
  });

  it.each([
    'NODE_ENV',
    'PATH',
    'HOME',
    'PORT',
    'HOSTNAME',
    'LANG',
    'TZ',
  ])('does not flag %s as sensitive', (name) => {
    expect(isSensitiveEnvVar(name)).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isSensitiveEnvVar('api_key')).toBe(true);
    expect(isSensitiveEnvVar('Api_Key')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// maskSensitiveValue
// ---------------------------------------------------------------------------

describe('maskSensitiveValue', () => {
  it('fully masks short sensitive values (≤10 chars)', () => {
    expect(maskSensitiveValue('short', 'API_KEY')).toBe('********');
  });

  it('partially masks long sensitive values (>10 chars)', () => {
    const value = 'sk-ant-1234567890abcdef';
    const masked = maskSensitiveValue(value, 'API_KEY');
    expect(masked).toBe('sk-a...def');
  });

  it('does not mask non-sensitive values', () => {
    expect(maskSensitiveValue('anything', 'NODE_ENV')).toBe('anything');
  });
});

// ---------------------------------------------------------------------------
// maskDatabaseConnectionString
// ---------------------------------------------------------------------------

describe('maskDatabaseConnectionString', () => {
  it('masks PostgreSQL password', () => {
    const url = 'postgresql://user:mysecret@localhost:5432/db';
    const masked = maskDatabaseConnectionString(url);
    expect(masked).toContain('****');
    expect(masked).not.toContain('mysecret');
  });

  it('masks MySQL password', () => {
    const url = 'mysql://root:password123@db.example.com:3306/mydb';
    const masked = maskDatabaseConnectionString(url);
    expect(masked).not.toContain('password123');
  });

  it('masks Redis password', () => {
    const url = 'redis://default:redis-secret@cache.local:6379';
    const masked = maskDatabaseConnectionString(url);
    expect(masked).not.toContain('redis-secret');
  });

  it('preserves URLs without passwords', () => {
    const url = 'postgresql://localhost:5432/db';
    expect(maskDatabaseConnectionString(url)).toBe(url);
  });

  it('returns invalid URLs unchanged', () => {
    expect(maskDatabaseConnectionString('not-a-url')).toBe('not-a-url');
  });
});

// ---------------------------------------------------------------------------
// maskDatabaseConnectionStringsInText
// ---------------------------------------------------------------------------

describe('maskDatabaseConnectionStringsInText', () => {
  it('masks DB URLs embedded in text', () => {
    const text = 'DATABASE_URL=postgresql://user:secret@host:5432/db done';
    const masked = maskDatabaseConnectionStringsInText(text);
    expect(masked).not.toContain('secret');
  });

  it('masks multiple URLs in text', () => {
    const text = 'pg: postgres://u:p1@h1/d redis: redis://u:p2@h2:6379';
    const masked = maskDatabaseConnectionStringsInText(text);
    expect(masked).not.toContain('p1');
    expect(masked).not.toContain('p2');
  });

  it('masks AI-generated password fields (Chinese)', () => {
    const text = '密码: mysecretpwd';
    const masked = maskDatabaseConnectionStringsInText(text);
    expect(masked).not.toContain('mysecretpwd');
    expect(masked).toContain('****');
  });

  it('masks password field keywords (English)', () => {
    const text = 'password: MyPass123';
    const masked = maskDatabaseConnectionStringsInText(text);
    expect(masked).not.toContain('MyPass123');
  });

  it('does not double-mask already masked passwords', () => {
    const text = 'password: ****';
    expect(maskDatabaseConnectionStringsInText(text)).toBe(text);
  });

  it('returns empty/null input unchanged', () => {
    expect(maskDatabaseConnectionStringsInText('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// maskSensitiveJsonFields
// ---------------------------------------------------------------------------

describe('maskSensitiveJsonFields', () => {
  it('masks sensitive JSON field values', () => {
    const json = '{"apiKey":"sk-1234567890abcdef","name":"test"}';
    const masked = maskSensitiveJsonFields(json);
    expect(masked).not.toContain('sk-1234567890abcdef');
    expect(masked).toContain('"name":"test"');
  });

  it('does not mask non-sensitive JSON fields', () => {
    const json = '{"hostname":"example.com","port":"8080"}';
    expect(maskSensitiveJsonFields(json)).toBe(json);
  });

  it('returns empty/null input unchanged', () => {
    expect(maskSensitiveJsonFields('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// filterSensitiveEnvOutput
// ---------------------------------------------------------------------------

describe('filterSensitiveEnvOutput', () => {
  it('masks KEY=VALUE format', () => {
    const output = 'API_KEY=sk-1234567890abcdef\nNODE_ENV=production';
    const filtered = filterSensitiveEnvOutput(output);
    expect(filtered).not.toContain('sk-1234567890abcdef');
    expect(filtered).toContain('NODE_ENV=production');
  });

  it('masks export format', () => {
    const output = 'export SECRET_KEY="mysecretvalue123"';
    const filtered = filterSensitiveEnvOutput(output);
    expect(filtered).not.toContain('mysecretvalue123');
  });

  it('masks declare -x format', () => {
    const output = 'declare -x DATABASE_PASSWORD="dbpass12345"';
    const filtered = filterSensitiveEnvOutput(output);
    expect(filtered).not.toContain('dbpass12345');
  });

  it('masks DB connection strings in env output', () => {
    const output = 'DATABASE_URL=postgresql://user:secret@host/db';
    const filtered = filterSensitiveEnvOutput(output);
    expect(filtered).not.toContain('secret');
  });

  it('returns empty input unchanged', () => {
    expect(filterSensitiveEnvOutput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// containsSensitiveEnvVars
// ---------------------------------------------------------------------------

describe('containsSensitiveEnvVars', () => {
  it('returns true when sensitive env vars present', () => {
    expect(containsSensitiveEnvVars('API_KEY=abc')).toBe(true);
  });

  it('returns false for non-sensitive env vars', () => {
    expect(containsSensitiveEnvVars('NODE_ENV=production')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(containsSensitiveEnvVars('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeToolOutput
// ---------------------------------------------------------------------------

describe('sanitizeToolOutput', () => {
  it('masks and suppresses output containing sensitive env vars', () => {
    const result = sanitizeToolOutput('DATABASE_PASSWORD=supersecret123');
    expect(result.shouldSuppress).toBe(true);
    expect(result.masked).not.toContain('supersecret123');
  });

  it('masks JSON sensitive fields', () => {
    const result = sanitizeToolOutput('{"apiKey":"sk-1234567890abc"}');
    expect(result.shouldSuppress).toBe(true);
    expect(result.masked).not.toContain('sk-1234567890abc');
  });

  it('does not suppress normal output', () => {
    const result = sanitizeToolOutput('Hello, world!');
    expect(result.shouldSuppress).toBe(false);
    expect(result.masked).toBe('Hello, world!');
  });

  it('returns empty string for null/empty input', () => {
    expect(sanitizeToolOutput('').masked).toBe('');
    expect(sanitizeToolOutput('').shouldSuppress).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createStreamingSanitizer
// ---------------------------------------------------------------------------

describe('createStreamingSanitizer', () => {
  it('masks secrets in a single chunk', () => {
    const s = createStreamingSanitizer();
    const out = s.push('DATABASE_URL=postgresql://u:secret@h/d end');
    const flushed = s.flush();
    const combined = out + flushed;
    expect(combined).not.toContain('secret');
  });

  it('handles secret split across two chunks', () => {
    const s = createStreamingSanitizer();
    const out1 = s.push('start postgre');
    const out2 = s.push('sql://user:pass@host/db end');
    const flushed = s.flush();
    const combined = out1 + out2 + flushed;
    expect(combined).not.toContain('pass');
  });

  it('passes normal text through immediately', () => {
    const s = createStreamingSanitizer();
    const out = s.push('just normal text');
    expect(out).toBe('just normal text');
    expect(s.flush()).toBe('');
  });

  it('flush returns empty when buffer is empty', () => {
    const s = createStreamingSanitizer();
    expect(s.flush()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// User env var whitelist
// ---------------------------------------------------------------------------

describe('user env var whitelist', () => {
  it('registers and checks user env vars', () => {
    registerUserEnvVars(['MY_CUSTOM_TOKEN', 'MY_SECRET']);
    expect(isUserEnvVar('MY_CUSTOM_TOKEN')).toBe(true);
    expect(isUserEnvVar('MY_SECRET')).toBe(true);
    expect(isUserEnvVar('RANDOM_VAR')).toBe(false);
  });

  it('clears whitelist', () => {
    registerUserEnvVars(['MY_TOKEN']);
    expect(isUserEnvVar('MY_TOKEN')).toBe(true);
    clearUserEnvVars();
    expect(isUserEnvVar('MY_TOKEN')).toBe(false);
  });
});
