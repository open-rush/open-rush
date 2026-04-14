import { describe, expect, it } from 'vitest';
import {
  Agent,
  CreateAgentRequest,
  ProjectAgent,
  SetCurrentProjectAgentRequest,
} from '../agent.js';
import { ApiResponse, CreateRunRequest, CreateRunResponse } from '../api.js';
import { Artifact } from '../artifact.js';
import { RunCheckpoint } from '../checkpoint.js';
import { RunEvent, UIMessageChunk } from '../events.js';
import { Project, ProjectMember } from '../project.js';
import { Run, RunSpec } from '../run.js';
import { SandboxInfo } from '../sandbox.js';
import { VaultEntry } from '../vault.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '660e8400-e29b-41d4-a716-446655440000';
const NOW = new Date().toISOString();

// --- Run ---

describe('Run', () => {
  const validRun = {
    id: UUID,
    agentId: UUID2,
    prompt: 'Build a web app',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses valid run with defaults', () => {
    const r = Run.parse(validRun);
    expect(r.status).toBe('queued');
    expect(r.provider).toBe('claude-code');
    expect(r.connectionMode).toBe('anthropic');
    expect(r.retryCount).toBe(0);
    expect(r.maxRetries).toBe(3);
    expect(r.parentRunId).toBeNull();
  });

  it('rejects empty prompt', () => {
    expect(() => Run.parse({ ...validRun, prompt: '' })).toThrow();
  });

  it('rejects invalid UUID for id', () => {
    expect(() => Run.parse({ ...validRun, id: 'not-uuid' })).toThrow();
  });

  it('rejects negative retryCount', () => {
    expect(() => Run.parse({ ...validRun, retryCount: -1 })).toThrow();
  });

  it('rejects retryCount > maxRetries', () => {
    expect(() => Run.parse({ ...validRun, retryCount: 4, maxRetries: 3 })).toThrow();
  });

  it('accepts retryCount == maxRetries', () => {
    const r = Run.parse({ ...validRun, retryCount: 3, maxRetries: 3 });
    expect(r.retryCount).toBe(3);
  });

  it('accepts all valid statuses', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'worker_unreachable']) {
      expect(Run.parse({ ...validRun, status }).status).toBe(status);
    }
  });

  it('coerces string dates to Date objects', () => {
    const r = Run.parse(validRun);
    expect(r.createdAt).toBeInstanceOf(Date);
  });
});

describe('RunSpec', () => {
  it('parses minimal valid spec', () => {
    const s = RunSpec.parse({ prompt: 'hello', projectId: UUID });
    expect(s.prompt).toBe('hello');
    expect(s.projectId).toBe(UUID);
  });

  it('rejects missing prompt', () => {
    expect(() => RunSpec.parse({ projectId: UUID })).toThrow();
  });

  it('rejects missing projectId', () => {
    expect(() => RunSpec.parse({ prompt: 'hello' })).toThrow();
  });

  it('accepts optional fields', () => {
    const s = RunSpec.parse({
      prompt: 'hello',
      projectId: UUID,
      agentId: UUID2,
      connectionMode: 'bedrock',
      model: 'claude-sonnet-4-6',
      triggerSource: 'webhook',
    });
    expect(s.connectionMode).toBe('bedrock');
    expect(s.triggerSource).toBe('webhook');
  });
});

// --- Agent ---

describe('Agent', () => {
  const validAgent = {
    id: UUID,
    projectId: UUID2,
    name: 'Web Builder',
    createdAt: NOW,
    updatedAt: NOW,
    lastActiveAt: NOW,
  };

  it('parses with defaults', () => {
    const a = Agent.parse(validAgent);
    expect(a.status).toBe('active');
    expect(a.deliveryMode).toBe('chat');
    expect(a.customTitle).toBeNull();
    expect(a.config).toBeNull();
  });

  it('rejects customTitle over 200 chars', () => {
    expect(() => Agent.parse({ ...validAgent, customTitle: 'a'.repeat(201) })).toThrow();
  });

  it('accepts customTitle at 200 chars', () => {
    const a = Agent.parse({ ...validAgent, customTitle: 'a'.repeat(200) });
    expect(a.customTitle).toHaveLength(200);
  });

  it('rejects maxSteps over 100', () => {
    expect(() => Agent.parse({ ...validAgent, maxSteps: 101 })).toThrow();
  });
});

describe('CreateAgentRequest', () => {
  it('parses minimal valid request', () => {
    const req = CreateAgentRequest.parse({
      projectId: UUID,
      name: 'Research Agent',
    });
    expect(req.projectId).toBe(UUID);
    expect(req.deliveryMode).toBe('chat');
  });
});

describe('ProjectAgent', () => {
  const validProjectAgent = {
    id: UUID,
    projectId: UUID,
    agentId: UUID2,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses with defaults', () => {
    const pa = ProjectAgent.parse(validProjectAgent);
    expect(pa.isCurrent).toBe(false);
    expect(pa.configOverride).toBeNull();
  });
});

describe('SetCurrentProjectAgentRequest', () => {
  it('requires agentId', () => {
    const req = SetCurrentProjectAgentRequest.parse({ agentId: UUID });
    expect(req.agentId).toBe(UUID);
  });
});

// --- Project ---

describe('Project', () => {
  const validProject = {
    id: UUID,
    name: 'My Project',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses with defaults', () => {
    const p = Project.parse(validProject);
    expect(p.sandboxProvider).toBe('opensandbox');
    expect(p.defaultConnectionMode).toBe('anthropic');
    expect(p.description).toBeNull();
  });

  it('rejects empty name', () => {
    expect(() => Project.parse({ ...validProject, name: '' })).toThrow();
  });

  it('rejects name over 255 chars', () => {
    expect(() => Project.parse({ ...validProject, name: 'x'.repeat(256) })).toThrow();
  });

  it('accepts name at 255 chars', () => {
    const p = Project.parse({ ...validProject, name: 'x'.repeat(255) });
    expect(p.name).toHaveLength(255);
  });
});

describe('ProjectMember', () => {
  it('parses with default role', () => {
    const m = ProjectMember.parse({
      id: UUID,
      projectId: UUID,
      userId: UUID2,
      createdAt: NOW,
    });
    expect(m.role).toBe('member');
  });

  it('accepts owner role', () => {
    const m = ProjectMember.parse({
      id: UUID,
      projectId: UUID,
      userId: UUID2,
      role: 'owner',
      createdAt: NOW,
    });
    expect(m.role).toBe('owner');
  });

  it('rejects invalid role', () => {
    expect(() =>
      ProjectMember.parse({
        id: UUID,
        projectId: UUID,
        userId: UUID2,
        role: 'superadmin',
        createdAt: NOW,
      })
    ).toThrow();
  });
});

// --- Events ---

describe('UIMessageChunk', () => {
  it('parses text-delta', () => {
    const c = UIMessageChunk.parse({ type: 'text-delta', delta: 'hello' });
    expect(c.type).toBe('text-delta');
    expect(c.delta).toBe('hello');
  });

  it('parses tool event', () => {
    const c = UIMessageChunk.parse({
      type: 'tool-input-available',
      toolCallId: 'tc-1',
      toolName: 'bash',
      input: { command: 'ls' },
    });
    expect(c.toolName).toBe('bash');
  });

  it('rejects invalid type', () => {
    expect(() => UIMessageChunk.parse({ type: 'invalid-type' })).toThrow();
  });
});

describe('RunEvent', () => {
  it('parses valid event', () => {
    const e = RunEvent.parse({
      id: UUID,
      runId: UUID2,
      eventType: 'message',
      seq: 0,
      createdAt: NOW,
    });
    expect(e.seq).toBe(0);
    expect(e.schemaVersion).toBe('1');
  });

  it('rejects negative seq', () => {
    expect(() =>
      RunEvent.parse({
        id: UUID,
        runId: UUID2,
        eventType: 'message',
        seq: -1,
        createdAt: NOW,
      })
    ).toThrow();
  });

  it('rejects empty eventType', () => {
    expect(() =>
      RunEvent.parse({
        id: UUID,
        runId: UUID2,
        eventType: '',
        seq: 0,
        createdAt: NOW,
      })
    ).toThrow();
  });
});

// --- Artifact ---

describe('Artifact', () => {
  const valid = {
    id: UUID,
    runId: UUID2,
    kind: 'diff',
    path: '/workspace/patch.diff',
    storagePath: 's3://bucket/patch.diff',
    contentType: 'text/plain',
    size: 1024,
    checksum: 'abc123',
    createdAt: NOW,
  };

  it('parses valid artifact', () => {
    const a = Artifact.parse(valid);
    expect(a.kind).toBe('diff');
    expect(a.size).toBe(1024);
  });

  it('rejects negative size', () => {
    expect(() => Artifact.parse({ ...valid, size: -1 })).toThrow();
  });

  it('accepts zero size', () => {
    expect(Artifact.parse({ ...valid, size: 0 }).size).toBe(0);
  });

  it('rejects empty checksum', () => {
    expect(() => Artifact.parse({ ...valid, checksum: '' })).toThrow();
  });

  it('rejects invalid kind', () => {
    expect(() => Artifact.parse({ ...valid, kind: 'video' })).toThrow();
  });

  for (const kind of ['diff', 'patch', 'log', 'screenshot', 'build', 'report']) {
    it(`accepts kind "${kind}"`, () => {
      expect(Artifact.parse({ ...valid, kind }).kind).toBe(kind);
    });
  }
});

// --- Sandbox ---

describe('SandboxInfo', () => {
  const valid = {
    id: UUID,
    externalId: 'sandbox-123',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses with defaults', () => {
    const s = SandboxInfo.parse(valid);
    expect(s.status).toBe('creating');
    expect(s.providerType).toBe('opensandbox');
    expect(s.agentId).toBeNull();
  });

  it('rejects empty externalId', () => {
    expect(() => SandboxInfo.parse({ ...valid, externalId: '' })).toThrow();
  });

  it('accepts all sandbox statuses', () => {
    for (const status of ['creating', 'running', 'idle', 'destroying', 'destroyed', 'error']) {
      expect(SandboxInfo.parse({ ...valid, status }).status).toBe(status);
    }
  });
});

// --- Vault ---

describe('VaultEntry', () => {
  const platformEntry = {
    id: UUID,
    scope: 'platform',
    projectId: null,
    name: 'API_KEY',
    encryptedValue: 'enc:xxx',
    createdAt: NOW,
    updatedAt: NOW,
  };

  const projectEntry = {
    id: UUID,
    scope: 'project',
    projectId: UUID2,
    name: 'DB_PASSWORD',
    encryptedValue: 'enc:yyy',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses valid platform entry', () => {
    const v = VaultEntry.parse(platformEntry);
    expect(v.scope).toBe('platform');
    expect(v.projectId).toBeNull();
  });

  it('parses valid project entry', () => {
    const v = VaultEntry.parse(projectEntry);
    expect(v.scope).toBe('project');
    expect(v.projectId).toBe(UUID2);
  });

  it('rejects platform scope with non-null projectId', () => {
    expect(() => VaultEntry.parse({ ...platformEntry, projectId: UUID2 })).toThrow();
  });

  it('rejects project scope with null projectId', () => {
    expect(() => VaultEntry.parse({ ...projectEntry, projectId: null })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => VaultEntry.parse({ ...platformEntry, name: '' })).toThrow();
  });

  it('rejects empty encryptedValue', () => {
    expect(() => VaultEntry.parse({ ...platformEntry, encryptedValue: '' })).toThrow();
  });

  it('defaults keyVersion to 1', () => {
    const v = VaultEntry.parse(platformEntry);
    expect(v.keyVersion).toBe(1);
  });
});

// --- Checkpoint ---

describe('RunCheckpoint', () => {
  const valid = {
    id: UUID,
    createdAt: NOW,
  };

  it('parses with defaults', () => {
    const c = RunCheckpoint.parse(valid);
    expect(c.status).toBe('in_progress');
    expect(c.degradedRecovery).toBe(false);
    expect(c.runId).toBeNull();
  });

  it('accepts all checkpoint statuses', () => {
    for (const status of ['in_progress', 'completed', 'failed']) {
      expect(RunCheckpoint.parse({ ...valid, status }).status).toBe(status);
    }
  });
});

// --- API ---

describe('CreateRunRequest', () => {
  it('is equivalent to RunSpec', () => {
    const req = CreateRunRequest.parse({ prompt: 'hello', projectId: UUID });
    expect(req.prompt).toBe('hello');
  });
});

describe('CreateRunResponse', () => {
  it('parses valid response', () => {
    const res = CreateRunResponse.parse({
      runId: UUID,
      agentId: UUID2,
      isNewAgent: true,
    });
    expect(res.isNewAgent).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(() => CreateRunResponse.parse({ runId: UUID })).toThrow();
  });
});

describe('ApiResponse', () => {
  it('parses success response', () => {
    const r = ApiResponse.parse({ success: true, data: { id: UUID } });
    expect(r.success).toBe(true);
  });

  it('parses error response', () => {
    const r = ApiResponse.parse({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    expect(r.error).toBe('Not found');
  });

  it('rejects missing success field', () => {
    expect(() => ApiResponse.parse({ data: {} })).toThrow();
  });
});
