import { describe, expect, it } from 'vitest';
import {
  createProjectRequestSchema,
  createProjectResponseSchema,
  getProjectParamsSchema,
  getProjectResponseSchema,
  listProjectsQuerySchema,
  listProjectsResponseSchema,
  projectSchema,
  SandboxProviderId,
} from '../projects.js';

const project = {
  id: '00000000-0000-0000-0000-000000000070',
  name: 'demo',
  description: null,
  sandboxProvider: 'opensandbox' as const,
  defaultModel: null,
  defaultConnectionMode: null,
  createdBy: null,
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
};

describe('SandboxProviderId enum', () => {
  it('accepts known providers', () => {
    for (const id of ['opensandbox', 'e2b', 'docker', 'custom']) {
      expect(SandboxProviderId.parse(id)).toBe(id);
    }
  });

  it('rejects unknown provider', () => {
    expect(SandboxProviderId.safeParse('k8s').success).toBe(false);
  });
});

describe('createProjectRequestSchema', () => {
  it('accepts minimal body with default sandboxProvider', () => {
    const parsed = createProjectRequestSchema.parse({ name: 'a' });
    expect(parsed.sandboxProvider).toBe('opensandbox');
  });

  it('rejects empty name', () => {
    expect(createProjectRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects name > 255 chars', () => {
    expect(createProjectRequestSchema.safeParse({ name: 'x'.repeat(256) }).success).toBe(false);
  });

  it('accepts defaultConnectionMode enum', () => {
    expect(
      createProjectRequestSchema.parse({ name: 'a', defaultConnectionMode: 'bedrock' })
        .defaultConnectionMode
    ).toBe('bedrock');
  });
});

describe('projectSchema', () => {
  it('round-trips valid entity', () => {
    expect(projectSchema.parse(project).sandboxProvider).toBe('opensandbox');
  });
});

describe('envelope + list', () => {
  it('createProjectResponseSchema wraps project', () => {
    expect(createProjectResponseSchema.parse({ data: project }).data.name).toBe('demo');
  });

  it('listProjectsQuerySchema accepts q filter', () => {
    expect(listProjectsQuerySchema.parse({ q: 'hello' }).q).toBe('hello');
  });

  it('listProjectsResponseSchema paginated', () => {
    expect(
      listProjectsResponseSchema.parse({ data: [project], nextCursor: null }).data
    ).toHaveLength(1);
  });

  it('getProjectParamsSchema requires UUID', () => {
    expect(getProjectParamsSchema.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('getProjectResponseSchema', () => {
    expect(getProjectResponseSchema.parse({ data: project }).data.id).toBeTruthy();
  });
});
