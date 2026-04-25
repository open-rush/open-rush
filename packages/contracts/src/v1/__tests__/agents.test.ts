import { describe, expect, it } from 'vitest';
import {
  AgentStatus,
  agentSchema,
  createAgentRequestSchema,
  createAgentResponseSchema,
  deleteAgentResponseSchema,
  listAgentsQuerySchema,
  listAgentsResponseSchema,
} from '../agents.js';

const agent = {
  id: '00000000-0000-0000-0000-000000000010',
  projectId: '00000000-0000-0000-0000-000000000002',
  definitionId: '00000000-0000-0000-0000-000000000020',
  definitionVersion: 1,
  mode: 'chat' as const,
  status: 'active' as const,
  title: 'My Agent',
  headRunId: null,
  activeRunId: null,
  createdBy: '00000000-0000-0000-0000-000000000001',
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
};

describe('AgentStatus enum', () => {
  it('accepts active/completed/cancelled', () => {
    for (const s of ['active', 'completed', 'cancelled']) {
      expect(AgentStatus.parse(s)).toBe(s);
    }
  });

  it('rejects legacy status "archived"', () => {
    expect(AgentStatus.safeParse('archived').success).toBe(false);
  });
});

describe('createAgentRequestSchema', () => {
  it('accepts minimal body (no initialInput, no explicit version)', () => {
    const body = {
      definitionId: '00000000-0000-0000-0000-000000000020',
      projectId: '00000000-0000-0000-0000-000000000002',
      mode: 'chat' as const,
    };
    expect(createAgentRequestSchema.parse(body)).toMatchObject(body);
  });

  it('accepts body with explicit definitionVersion and initialInput', () => {
    expect(
      createAgentRequestSchema.parse({
        definitionId: '00000000-0000-0000-0000-000000000020',
        projectId: '00000000-0000-0000-0000-000000000002',
        mode: 'workspace',
        definitionVersion: 3,
        initialInput: 'go',
        title: 'Task A',
      })
    ).toMatchObject({ definitionVersion: 3 });
  });

  it('rejects missing mode', () => {
    expect(
      createAgentRequestSchema.safeParse({
        definitionId: '00000000-0000-0000-0000-000000000020',
        projectId: '00000000-0000-0000-0000-000000000002',
      }).success
    ).toBe(false);
  });

  it('rejects negative definitionVersion', () => {
    expect(
      createAgentRequestSchema.safeParse({
        definitionId: '00000000-0000-0000-0000-000000000020',
        projectId: '00000000-0000-0000-0000-000000000002',
        mode: 'chat',
        definitionVersion: 0,
      }).success
    ).toBe(false);
  });

  it('rejects non-UUID definitionId', () => {
    expect(
      createAgentRequestSchema.safeParse({
        definitionId: 'not-a-uuid',
        projectId: '00000000-0000-0000-0000-000000000002',
        mode: 'chat',
      }).success
    ).toBe(false);
  });

  it('rejects title > 200 chars', () => {
    expect(
      createAgentRequestSchema.safeParse({
        definitionId: '00000000-0000-0000-0000-000000000020',
        projectId: '00000000-0000-0000-0000-000000000002',
        mode: 'chat',
        title: 'x'.repeat(201),
      }).success
    ).toBe(false);
  });
});

describe('agentSchema', () => {
  it('round-trips a valid entity', () => {
    expect(agentSchema.parse(agent)).toMatchObject({ definitionVersion: 1 });
  });

  it('accepts nullable title / run ids', () => {
    expect(
      agentSchema.parse({ ...agent, title: null, headRunId: null, activeRunId: null }).title
    ).toBeNull();
  });

  it('rejects non-positive definitionVersion', () => {
    expect(agentSchema.safeParse({ ...agent, definitionVersion: 0 }).success).toBe(false);
  });
});

describe('createAgentResponseSchema', () => {
  it('accepts envelope with agent + nullable firstRunId', () => {
    expect(
      createAgentResponseSchema.parse({ data: { agent, firstRunId: null } }).data.firstRunId
    ).toBeNull();
  });
});

describe('listAgentsQuerySchema', () => {
  it('accepts status filter', () => {
    expect(listAgentsQuerySchema.parse({ status: 'cancelled' }).status).toBe('cancelled');
  });

  it('accepts projectId + definitionId filters', () => {
    expect(
      listAgentsQuerySchema.parse({
        projectId: '00000000-0000-0000-0000-000000000002',
        definitionId: '00000000-0000-0000-0000-000000000020',
      }).projectId
    ).toBeTruthy();
  });
});

describe('listAgentsResponseSchema', () => {
  it('paginated envelope shape', () => {
    expect(listAgentsResponseSchema.parse({ data: [agent], nextCursor: null }).data).toHaveLength(
      1
    );
  });
});

describe('deleteAgentResponseSchema', () => {
  it('fixes status to literal "cancelled"', () => {
    expect(
      deleteAgentResponseSchema.parse({
        data: {
          id: '00000000-0000-0000-0000-000000000010',
          status: 'cancelled',
          cancelledRunId: null,
        },
      }).data.status
    ).toBe('cancelled');
  });

  it('rejects non-cancelled status (protocol invariant)', () => {
    expect(
      deleteAgentResponseSchema.safeParse({
        data: {
          id: '00000000-0000-0000-0000-000000000010',
          status: 'active',
          cancelledRunId: null,
        },
      }).success
    ).toBe(false);
  });
});
