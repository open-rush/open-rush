import { describe, expect, it } from 'vitest';
import {
  AgentStatus,
  ArtifactKind,
  CheckpointStatus,
  ConnectionMode,
  isValidRunTransition,
  ProjectMemberRole,
  RETRYABLE_RUN_STATUSES,
  RunStatus,
  SandboxStatus,
  TERMINAL_RUN_STATUSES,
  TriggerSource,
  UIMessageChunkType,
  VALID_RUN_TRANSITIONS,
  VaultScope,
} from '../enums.js';

describe('RunStatus', () => {
  it('has exactly 15 values', () => {
    expect(RunStatus.options).toHaveLength(15);
  });

  it('parses valid status', () => {
    expect(RunStatus.parse('queued')).toBe('queued');
    expect(RunStatus.parse('completed')).toBe('completed');
  });

  it('rejects invalid status', () => {
    expect(() => RunStatus.parse('invalid')).toThrow();
    expect(() => RunStatus.parse('')).toThrow();
    expect(() => RunStatus.parse(123)).toThrow();
  });
});

describe('VALID_RUN_TRANSITIONS', () => {
  it('covers all 15 statuses', () => {
    expect(Object.keys(VALID_RUN_TRANSITIONS)).toHaveLength(15);
  });

  it('completed is terminal (no outgoing transitions)', () => {
    expect(VALID_RUN_TRANSITIONS.completed).toHaveLength(0);
  });

  it('queued can go to provisioning or failed', () => {
    expect(VALID_RUN_TRANSITIONS.queued).toContain('provisioning');
    expect(VALID_RUN_TRANSITIONS.queued).toContain('failed');
  });

  it('failed can retry back to queued', () => {
    expect(VALID_RUN_TRANSITIONS.failed).toContain('queued');
  });

  it('finalization follows ordered sequence', () => {
    expect(VALID_RUN_TRANSITIONS.finalizing_prepare).toContain('finalizing_uploading');
    expect(VALID_RUN_TRANSITIONS.finalizing_uploading).toContain('finalizing_verifying');
    expect(VALID_RUN_TRANSITIONS.finalizing_verifying).toContain('finalizing_metadata_commit');
    expect(VALID_RUN_TRANSITIONS.finalizing_metadata_commit).toContain('finalized');
    expect(VALID_RUN_TRANSITIONS.finalized).toContain('completed');
  });

  it('worker_unreachable can recover or fail', () => {
    expect(VALID_RUN_TRANSITIONS.worker_unreachable).toContain('running');
    expect(VALID_RUN_TRANSITIONS.worker_unreachable).toContain('failed');
  });
});

describe('TERMINAL_RUN_STATUSES', () => {
  it('only contains completed (not failed — failed is retryable)', () => {
    expect(TERMINAL_RUN_STATUSES).toEqual(['completed']);
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const s of TERMINAL_RUN_STATUSES) {
      expect(VALID_RUN_TRANSITIONS[s]).toHaveLength(0);
    }
  });
});

describe('RETRYABLE_RUN_STATUSES', () => {
  it('contains failed', () => {
    expect(RETRYABLE_RUN_STATUSES).toContain('failed');
  });

  it('retryable statuses have outgoing transitions', () => {
    for (const s of RETRYABLE_RUN_STATUSES) {
      expect(VALID_RUN_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  });
});

describe('isValidRunTransition', () => {
  it('allows valid transition', () => {
    expect(isValidRunTransition('queued', 'provisioning')).toBe(true);
  });

  it('rejects invalid transition', () => {
    expect(isValidRunTransition('queued', 'completed')).toBe(false);
  });

  it('rejects self-transition for completed', () => {
    expect(isValidRunTransition('completed', 'completed')).toBe(false);
  });

  it('allows retry from failed to queued', () => {
    expect(isValidRunTransition('failed', 'queued')).toBe(true);
  });

  it('rejects skipping finalization steps', () => {
    expect(isValidRunTransition('finalizing_prepare', 'finalized')).toBe(false);
    expect(isValidRunTransition('running', 'completed')).toBe(false);
  });
});

describe('AgentStatus', () => {
  it('has 2 values', () => {
    expect(AgentStatus.options).toHaveLength(2);
  });

  it('parses valid values', () => {
    expect(AgentStatus.parse('active')).toBe('active');
    expect(AgentStatus.parse('inactive')).toBe('inactive');
  });

  it('rejects closed (legacy status)', () => {
    expect(() => AgentStatus.parse('closed')).toThrow();
  });

  it('rejects deleted (not in open-rush)', () => {
    expect(() => AgentStatus.parse('deleted')).toThrow();
  });
});

describe('TriggerSource', () => {
  it('has 3 values', () => {
    expect(TriggerSource.options).toHaveLength(3);
  });

  for (const v of ['user', 'webhook', 'api']) {
    it(`parses "${v}"`, () => {
      expect(TriggerSource.parse(v)).toBe(v);
    });
  }
});

describe('ConnectionMode', () => {
  it('has 3 values', () => {
    expect(ConnectionMode.options).toHaveLength(3);
  });

  for (const v of ['anthropic', 'bedrock', 'custom']) {
    it(`parses "${v}"`, () => {
      expect(ConnectionMode.parse(v)).toBe(v);
    });
  }
});

describe('ArtifactKind', () => {
  it('has 6 values', () => {
    expect(ArtifactKind.options).toHaveLength(6);
  });
});

describe('SandboxStatus', () => {
  it('has 6 values', () => {
    expect(SandboxStatus.options).toHaveLength(6);
  });
});

describe('VaultScope', () => {
  it('has 2 values', () => {
    expect(VaultScope.options).toHaveLength(2);
  });
});

describe('CheckpointStatus', () => {
  it('has 3 values', () => {
    expect(CheckpointStatus.options).toHaveLength(3);
  });
});

describe('ProjectMemberRole', () => {
  it('has 3 values', () => {
    expect(ProjectMemberRole.options).toHaveLength(3);
  });
});

describe('UIMessageChunkType', () => {
  it('has 16 event types', () => {
    expect(UIMessageChunkType.options).toHaveLength(16);
  });

  it('includes all text events', () => {
    for (const t of ['text-start', 'text-delta', 'text-end']) {
      expect(UIMessageChunkType.safeParse(t).success).toBe(true);
    }
  });

  it('includes all tool events', () => {
    for (const t of [
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-available',
      'tool-output-error',
    ]) {
      expect(UIMessageChunkType.safeParse(t).success).toBe(true);
    }
  });
});
