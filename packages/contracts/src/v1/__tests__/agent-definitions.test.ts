import { describe, expect, it } from 'vitest';
import {
  agentDefinitionSchema,
  archiveAgentDefinitionResponseSchema,
  createAgentDefinitionRequestSchema,
  createAgentDefinitionResponseSchema,
  getAgentDefinitionQuerySchema,
  ifMatchHeaderSchema,
  listAgentDefinitionsQuerySchema,
  listAgentDefinitionsResponseSchema,
  listAgentDefinitionVersionsResponseSchema,
  patchAgentDefinitionRequestSchema,
} from '../agent-definitions.js';

const baseEditable = {
  name: 'my-agent',
  providerType: 'claude-code',
  model: 'claude-sonnet-4.5',
  systemPrompt: 'helpful',
  appendSystemPrompt: null,
  allowedTools: ['Bash', 'Read'],
  skills: [],
  mcpServers: [],
  maxSteps: 30,
  deliveryMode: 'chat' as const,
  config: null,
};

const fullDef = {
  ...baseEditable,
  id: '00000000-0000-0000-0000-000000000001',
  projectId: '00000000-0000-0000-0000-000000000002',
  currentVersion: 1,
  archivedAt: null,
  description: null,
  icon: null,
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
};

describe('createAgentDefinitionRequestSchema', () => {
  it('accepts a valid create body', () => {
    const body = { ...baseEditable, projectId: '00000000-0000-0000-0000-000000000002' };
    expect(createAgentDefinitionRequestSchema.parse(body)).toMatchObject({
      name: 'my-agent',
      projectId: '00000000-0000-0000-0000-000000000002',
    });
  });

  it('rejects missing projectId', () => {
    expect(createAgentDefinitionRequestSchema.safeParse(baseEditable).success).toBe(false);
  });

  it('rejects non-UUID projectId', () => {
    expect(
      createAgentDefinitionRequestSchema.safeParse({ ...baseEditable, projectId: 'x' }).success
    ).toBe(false);
  });

  it('rejects out-of-range maxSteps', () => {
    expect(
      createAgentDefinitionRequestSchema.safeParse({
        ...baseEditable,
        projectId: '00000000-0000-0000-0000-000000000002',
        maxSteps: 0,
      }).success
    ).toBe(false);
    expect(
      createAgentDefinitionRequestSchema.safeParse({
        ...baseEditable,
        projectId: '00000000-0000-0000-0000-000000000002',
        maxSteps: 1001,
      }).success
    ).toBe(false);
  });

  it('rejects invalid deliveryMode', () => {
    expect(
      createAgentDefinitionRequestSchema.safeParse({
        ...baseEditable,
        projectId: '00000000-0000-0000-0000-000000000002',
        deliveryMode: 'bogus',
      }).success
    ).toBe(false);
  });
});

describe('patchAgentDefinitionRequestSchema', () => {
  it('accepts a single-field patch', () => {
    expect(patchAgentDefinitionRequestSchema.parse({ name: 'new' })).toMatchObject({
      name: 'new',
    });
  });

  it('accepts a patch with changeNote only-if-combined-with-a-field', () => {
    expect(
      patchAgentDefinitionRequestSchema.parse({ systemPrompt: 'x', changeNote: 'why' })
    ).toMatchObject({ systemPrompt: 'x', changeNote: 'why' });
  });

  it('rejects empty body', () => {
    expect(patchAgentDefinitionRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects body with ONLY changeNote (no editable field)', () => {
    expect(patchAgentDefinitionRequestSchema.safeParse({ changeNote: 'note only' }).success).toBe(
      false
    );
  });

  it('propagates per-field validation (bad deliveryMode)', () => {
    expect(patchAgentDefinitionRequestSchema.safeParse({ deliveryMode: 'unknown' }).success).toBe(
      false
    );
  });
});

describe('ifMatchHeaderSchema', () => {
  it('coerces string → positive int', () => {
    expect(ifMatchHeaderSchema.parse('3')).toBe(3);
  });

  it('rejects zero and negatives', () => {
    expect(ifMatchHeaderSchema.safeParse('0').success).toBe(false);
    expect(ifMatchHeaderSchema.safeParse('-1').success).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(ifMatchHeaderSchema.safeParse('1.5').success).toBe(false);
  });
});

describe('agentDefinitionSchema (response entity)', () => {
  it('round-trips a full valid entity', () => {
    expect(agentDefinitionSchema.parse(fullDef)).toMatchObject({ currentVersion: 1 });
  });

  it('rejects negative currentVersion', () => {
    expect(agentDefinitionSchema.safeParse({ ...fullDef, currentVersion: -1 }).success).toBe(false);
  });

  it('accepts archivedAt being an ISO date string or null', () => {
    expect(agentDefinitionSchema.parse({ ...fullDef, archivedAt: null }).archivedAt).toBeNull();
    expect(
      agentDefinitionSchema.parse({ ...fullDef, archivedAt: '2026-05-01T00:00:00Z' }).archivedAt
    ).toBe('2026-05-01T00:00:00Z');
  });
});

describe('envelope schemas', () => {
  it('createAgentDefinitionResponseSchema wraps a full entity', () => {
    expect(createAgentDefinitionResponseSchema.parse({ data: fullDef }).data.id).toBeTruthy();
  });

  it('listAgentDefinitionsQuerySchema: sensible defaults', () => {
    expect(listAgentDefinitionsQuerySchema.parse({})).toEqual({
      limit: 50,
      includeArchived: false,
    });
  });

  it('listAgentDefinitionsQuerySchema parses "true"/"false" strictly', () => {
    // Avoid JS Boolean() coercion — "false" is truthy there and would flip
    // the filter silently. We enforce canonical URL-query forms only.
    expect(listAgentDefinitionsQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(
      true
    );
    expect(
      listAgentDefinitionsQuerySchema.parse({ includeArchived: 'false' }).includeArchived
    ).toBe(false);
    expect(listAgentDefinitionsQuerySchema.parse({ includeArchived: true }).includeArchived).toBe(
      true
    );
    expect(listAgentDefinitionsQuerySchema.parse({ includeArchived: false }).includeArchived).toBe(
      false
    );
  });

  it('listAgentDefinitionsQuerySchema rejects non-canonical booleans', () => {
    expect(listAgentDefinitionsQuerySchema.safeParse({ includeArchived: '1' }).success).toBe(false);
    expect(listAgentDefinitionsQuerySchema.safeParse({ includeArchived: 'yes' }).success).toBe(
      false
    );
    expect(listAgentDefinitionsQuerySchema.safeParse({ includeArchived: 0 }).success).toBe(false);
  });

  it('listAgentDefinitionsResponseSchema shape', () => {
    expect(
      listAgentDefinitionsResponseSchema.parse({ data: [fullDef], nextCursor: null }).data
    ).toHaveLength(1);
  });

  it('getAgentDefinitionQuerySchema coerces version', () => {
    expect(getAgentDefinitionQuerySchema.parse({ version: '3' })).toEqual({ version: 3 });
  });

  it('archiveAgentDefinitionResponseSchema', () => {
    const parsed = archiveAgentDefinitionResponseSchema.parse({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        archivedAt: '2026-05-01T00:00:00Z',
      },
    });
    expect(parsed.data.archivedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('listAgentDefinitionVersionsResponseSchema items omit snapshot', () => {
    const parsed = listAgentDefinitionVersionsResponseSchema.parse({
      data: [
        {
          version: 1,
          changeNote: 'initial',
          createdBy: null,
          createdAt: '2026-04-25T00:00:00Z',
        },
      ],
      nextCursor: null,
    });
    expect((parsed.data[0] as Record<string, unknown>).snapshot).toBeUndefined();
  });
});
