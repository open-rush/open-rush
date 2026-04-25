import { describe, expect, it } from 'vitest';
import {
  listMcpsQuerySchema,
  listMcpsResponseSchema,
  listSkillsQuerySchema,
  listSkillsResponseSchema,
  mcpRegistryEntrySchema,
  skillSchema,
} from '../registry.js';

const skill = {
  id: '00000000-0000-0000-0000-000000000050',
  name: 'code-review',
  description: 'reviews diffs',
  sourceType: 'registry' as const,
  sourceUrl: null,
  category: 'engineering',
  tags: ['review', 'code'],
  visibility: 'public' as const,
  latestVersion: '1.0.0',
  starCount: 12,
  installCount: 100,
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
};

const mcp = {
  id: '00000000-0000-0000-0000-000000000060',
  name: 'github',
  displayName: 'GitHub',
  description: 'github tools',
  transportType: 'http' as const,
  tools: [],
  tags: [],
  category: 'developer-tools',
  author: 'foo',
  docUrl: 'https://example.com/doc',
  repoUrl: 'https://github.com/x/y',
  starCount: 5,
  isBuiltin: false,
  visibility: 'public' as const,
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
};

describe('skillSchema', () => {
  it('round-trips valid skill', () => {
    expect(skillSchema.parse(skill).name).toBe('code-review');
  });

  it('rejects negative counts', () => {
    expect(skillSchema.safeParse({ ...skill, starCount: -1 }).success).toBe(false);
    expect(skillSchema.safeParse({ ...skill, installCount: -1 }).success).toBe(false);
  });

  it('rejects invalid visibility', () => {
    expect(skillSchema.safeParse({ ...skill, visibility: 'secret' }).success).toBe(false);
  });

  it('accepts sourceType inline with null sourceUrl', () => {
    expect(skillSchema.parse({ ...skill, sourceType: 'inline', sourceUrl: null }).sourceType).toBe(
      'inline'
    );
  });
});

describe('listSkillsQuerySchema', () => {
  it('default pagination', () => {
    expect(listSkillsQuerySchema.parse({})).toMatchObject({ limit: 50 });
  });

  it('accepts q / category / visibility filters', () => {
    expect(
      listSkillsQuerySchema.parse({ q: 'code', category: 'eng', visibility: 'public' })
    ).toMatchObject({ q: 'code', category: 'eng', visibility: 'public' });
  });
});

describe('listSkillsResponseSchema', () => {
  it('paginated envelope', () => {
    expect(listSkillsResponseSchema.parse({ data: [skill], nextCursor: 'c' }).data).toHaveLength(1);
  });
});

describe('mcpRegistryEntrySchema', () => {
  it('round-trips valid mcp', () => {
    expect(mcpRegistryEntrySchema.parse(mcp).transportType).toBe('http');
  });

  it('rejects invalid transportType', () => {
    expect(mcpRegistryEntrySchema.safeParse({ ...mcp, transportType: 'ws' }).success).toBe(false);
  });

  it('accepts null docUrl / repoUrl / category / author', () => {
    expect(
      mcpRegistryEntrySchema.parse({
        ...mcp,
        docUrl: null,
        repoUrl: null,
        category: null,
        author: null,
      }).author
    ).toBeNull();
  });
});

describe('listMcpsQuerySchema + listMcpsResponseSchema', () => {
  it('supports transportType filter', () => {
    expect(listMcpsQuerySchema.parse({ transportType: 'stdio' }).transportType).toBe('stdio');
  });

  it('response paginated shape', () => {
    expect(listMcpsResponseSchema.parse({ data: [mcp], nextCursor: null }).data).toHaveLength(1);
  });
});
