import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { extractSkillDirName, verifyIntegrity } from '../installer.js';

// ---------------------------------------------------------------------------
// extractSkillDirName
// ---------------------------------------------------------------------------

describe('extractSkillDirName', () => {
  it('extracts last segment from @scope/name', () => {
    expect(extractSkillDirName('@kanyun/rush-log-helper')).toBe('rush-log-helper');
    expect(extractSkillDirName('@scope/name')).toBe('name');
  });

  it('returns entire string when no slash', () => {
    expect(extractSkillDirName('single-name')).toBe('single-name');
  });

  it('takes last segment from multi-segment path', () => {
    expect(extractSkillDirName('@a/b/c')).toBe('c');
  });

  it('returns empty for empty string', () => {
    expect(extractSkillDirName('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(extractSkillDirName('  @kanyun/foo  ')).toBe('foo');
  });
});

// ---------------------------------------------------------------------------
// verifyIntegrity
// ---------------------------------------------------------------------------

describe('verifyIntegrity', () => {
  it('passes when SHA256 matches', () => {
    const data = Buffer.from('hello world');
    const hash = createHash('sha256').update(data).digest('base64');
    expect(() => verifyIntegrity(data, `sha256-${hash}`)).not.toThrow();
  });

  it('throws when SHA256 does not match', () => {
    const data = Buffer.from('hello world');
    expect(() => verifyIntegrity(data, 'sha256-AAAAAAAAAA==')).toThrow('Integrity check failed');
  });

  it('skips verification when expected is empty', () => {
    expect(() => verifyIntegrity(Buffer.from('data'), '')).not.toThrow();
  });

  it('skips verification for non-standard format', () => {
    expect(() => verifyIntegrity(Buffer.from('data'), 'md5-abc')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SkillInstaller (mock-based)
// ---------------------------------------------------------------------------

describe('SkillInstaller', () => {
  // Note: Full SkillInstaller tests require mocking fs, child_process, etc.
  // These are integration-style tests that verify the class can be instantiated
  // with the correct interfaces.

  it('can be instantiated with resolver and default downloader', async () => {
    const { SkillInstaller } = await import('../installer.js');
    const mockResolver = {
      resolve: vi.fn().mockResolvedValue({ url: 'https://example.com/skill.tgz', integrity: '' }),
    };
    const installer = new SkillInstaller(mockResolver);
    expect(installer).toBeDefined();
  });

  it('isSkillInstalled returns false for non-existent path', async () => {
    const { SkillInstaller } = await import('../installer.js');
    const installer = new SkillInstaller({ resolve: vi.fn() });
    expect(installer.isSkillInstalled('/tmp/nonexistent-project', '@scope/test')).toBe(false);
  });

  it('ensureSkillsInstalled returns immediately for empty array', async () => {
    const { SkillInstaller } = await import('../installer.js');
    const resolveFn = vi.fn();
    const installer = new SkillInstaller({ resolve: resolveFn });
    await installer.ensureSkillsInstalled('/tmp/project', []);
    expect(resolveFn).not.toHaveBeenCalled();
  });
});
