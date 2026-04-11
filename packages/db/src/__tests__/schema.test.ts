import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  agents,
  artifacts,
  projectMembers,
  projects,
  runCheckpoints,
  runEvents,
  runs,
  sandboxes,
  sessions,
  users,
  vaultEntries,
  verificationTokens,
} from '../schema/index.js';

const ALL_TABLES = {
  users,
  accounts,
  sessions,
  verificationTokens,
  projects,
  projectMembers,
  agents,
  runs,
  runEvents,
  runCheckpoints,
  sandboxes,
  artifacts,
  vaultEntries,
} as const;

describe('schema table names', () => {
  const expectedNames: Record<string, string> = {
    users: 'users',
    accounts: 'accounts',
    sessions: 'sessions',
    verificationTokens: 'verification_tokens',
    projects: 'projects',
    projectMembers: 'project_members',
    agents: 'agents',
    runs: 'runs',
    runEvents: 'run_events',
    runCheckpoints: 'run_checkpoints',
    sandboxes: 'sandboxes',
    artifacts: 'artifacts',
    vaultEntries: 'vault_entries',
  };

  for (const [key, table] of Object.entries(ALL_TABLES)) {
    it(`${key} maps to table "${expectedNames[key]}"`, () => {
      expect(getTableName(table)).toBe(expectedNames[key]);
    });
  }
});

describe('schema exports all 13 tables', () => {
  it('has exactly 13 tables', () => {
    expect(Object.keys(ALL_TABLES)).toHaveLength(13);
  });
});

describe('key columns exist', () => {
  it('users has id, name, email, created_at', () => {
    const cols = Object.keys(getTableColumns(users));
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('email');
    expect(cols).toContain('createdAt');
  });

  it('runs has agent_id, status, prompt, provider, connection_mode', () => {
    const cols = Object.keys(getTableColumns(runs));
    expect(cols).toContain('agentId');
    expect(cols).toContain('status');
    expect(cols).toContain('prompt');
    expect(cols).toContain('provider');
    expect(cols).toContain('connectionMode');
  });

  it('run_events has run_id, seq, event_type, payload', () => {
    const cols = Object.keys(getTableColumns(runEvents));
    expect(cols).toContain('runId');
    expect(cols).toContain('seq');
    expect(cols).toContain('eventType');
    expect(cols).toContain('payload');
  });

  it('vault_entries has scope, project_id, encrypted_value, key_version', () => {
    const cols = Object.keys(getTableColumns(vaultEntries));
    expect(cols).toContain('scope');
    expect(cols).toContain('projectId');
    expect(cols).toContain('encryptedValue');
    expect(cols).toContain('keyVersion');
  });
});
