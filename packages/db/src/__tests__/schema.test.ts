import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  accounts,
  agentDefinitionVersions,
  agents,
  artifacts,
  projectAgents,
  projectMembers,
  projects,
  runCheckpoints,
  runEvents,
  runs,
  sandboxes,
  serviceTokens,
  sessions,
  tasks,
  users,
  vaultEntries,
  verificationTokens,
} from '../schema/index.js';

const ALL_TABLES = {
  users,
  accounts,
  sessions,
  verificationTokens,
  serviceTokens,
  projects,
  projectAgents,
  projectMembers,
  agents,
  agentDefinitionVersions,
  tasks,
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
    serviceTokens: 'service_tokens',
    projects: 'projects',
    projectAgents: 'project_agents',
    projectMembers: 'project_members',
    agents: 'agents',
    agentDefinitionVersions: 'agent_definition_versions',
    tasks: 'tasks',
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

describe('schema test tracks 17 core tables', () => {
  it('has exactly 17 tracked tables', () => {
    expect(Object.keys(ALL_TABLES)).toHaveLength(17);
  });
});

describe('service_tokens column shape', () => {
  it('exposes token_hash, name, owner_user_id, scopes, timestamps', () => {
    const cols = Object.keys(getTableColumns(serviceTokens));
    expect(cols).toContain('tokenHash');
    expect(cols).toContain('name');
    expect(cols).toContain('ownerUserId');
    expect(cols).toContain('scopes');
    expect(cols).toContain('lastUsedAt');
    expect(cols).toContain('expiresAt');
    expect(cols).toContain('revokedAt');
    expect(cols).toContain('createdAt');
  });
});

describe('agents AgentDefinition versioning columns', () => {
  it('agents table exposes current_version and archived_at columns', () => {
    const cols = Object.keys(getTableColumns(agents));
    expect(cols).toContain('currentVersion');
    expect(cols).toContain('archivedAt');
  });

  it('agent_definition_versions has agent_id, version, snapshot, change_note, created_by', () => {
    const cols = Object.keys(getTableColumns(agentDefinitionVersions));
    expect(cols).toContain('agentId');
    expect(cols).toContain('version');
    expect(cols).toContain('snapshot');
    expect(cols).toContain('changeNote');
    expect(cols).toContain('createdBy');
    expect(cols).toContain('createdAt');
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
    expect(cols).toContain('taskId');
    expect(cols).toContain('conversationId');
    expect(cols).toContain('status');
    expect(cols).toContain('prompt');
    expect(cols).toContain('provider');
    expect(cols).toContain('connectionMode');
  });

  it('tasks has project_id, agent_id, created_by, head_run_id, active_run_id', () => {
    const cols = Object.keys(getTableColumns(tasks));
    expect(cols).toContain('projectId');
    expect(cols).toContain('agentId');
    expect(cols).toContain('createdBy');
    expect(cols).toContain('headRunId');
    expect(cols).toContain('activeRunId');
  });

  it('project_agents has project_id, agent_id, is_current, config_override', () => {
    const cols = Object.keys(getTableColumns(projectAgents));
    expect(cols).toContain('projectId');
    expect(cols).toContain('agentId');
    expect(cols).toContain('isCurrent');
    expect(cols).toContain('configOverride');
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
