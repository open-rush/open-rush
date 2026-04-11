import { describe, expect, it } from 'vitest';
import { formatDatabaseUrlForLog, parsePoolMax } from '../client.js';

describe('parsePoolMax', () => {
  it('returns 10 for undefined', () => {
    expect(parsePoolMax(undefined)).toBe(10);
  });

  it('returns 10 for empty string', () => {
    expect(parsePoolMax('')).toBe(10);
  });

  it('parses valid number', () => {
    expect(parsePoolMax('20')).toBe(20);
  });

  it('caps at 100', () => {
    expect(parsePoolMax('200')).toBe(100);
  });

  it('returns 10 for NaN', () => {
    expect(parsePoolMax('abc')).toBe(10);
  });

  it('returns 10 for zero', () => {
    expect(parsePoolMax('0')).toBe(10);
  });

  it('returns 10 for negative', () => {
    expect(parsePoolMax('-5')).toBe(10);
  });
});

describe('formatDatabaseUrlForLog', () => {
  it('masks password in standard URL', () => {
    const result = formatDatabaseUrlForLog('postgresql://rush:secret@localhost:5432/rush');
    expect(result).toContain('***');
    expect(result).not.toContain('secret');
  });

  it('handles URL without password', () => {
    const result = formatDatabaseUrlForLog('postgresql://localhost:5432/rush');
    expect(result).toContain('localhost');
  });

  it('handles malformed URL gracefully', () => {
    const result = formatDatabaseUrlForLog('not-a-url');
    expect(result).toBe('not-a-url');
  });
});
