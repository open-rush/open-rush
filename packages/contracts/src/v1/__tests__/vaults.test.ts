import { describe, expect, it } from 'vitest';
import {
  createVaultEntryRequestSchema,
  createVaultEntryResponseSchema,
  deleteVaultEntryParamsSchema,
  listVaultEntriesQuerySchema,
  listVaultEntriesResponseSchema,
  vaultEntrySchema,
} from '../vaults.js';

const entry = {
  id: '00000000-0000-0000-0000-000000000040',
  scope: 'project' as const,
  projectId: '00000000-0000-0000-0000-000000000002',
  ownerId: '00000000-0000-0000-0000-000000000001',
  name: 'ANTHROPIC_API_KEY',
  credentialType: 'anthropic_api' as const,
  keyVersion: 1,
  injectionTarget: 'ANTHROPIC_API_KEY',
  createdAt: '2026-04-25T00:00:00Z',
  updatedAt: '2026-04-25T00:00:00Z',
};

describe('createVaultEntryRequestSchema', () => {
  it('accepts valid project-scope entry', () => {
    expect(
      createVaultEntryRequestSchema.parse({
        scope: 'project',
        projectId: '00000000-0000-0000-0000-000000000002',
        name: 'K',
        credentialType: 'env_var',
        value: 'plaintext',
      }).scope
    ).toBe('project');
  });

  it('accepts valid platform-scope entry with no projectId', () => {
    expect(
      createVaultEntryRequestSchema.parse({
        scope: 'platform',
        name: 'GLOBAL_KEY',
        credentialType: 'env_var',
        value: 'x',
      }).scope
    ).toBe('platform');
  });

  it('rejects project-scope with no projectId', () => {
    expect(
      createVaultEntryRequestSchema.safeParse({
        scope: 'project',
        name: 'K',
        credentialType: 'env_var',
        value: 'x',
      }).success
    ).toBe(false);
  });

  it('rejects platform-scope with projectId set', () => {
    expect(
      createVaultEntryRequestSchema.safeParse({
        scope: 'platform',
        projectId: '00000000-0000-0000-0000-000000000002',
        name: 'K',
        credentialType: 'env_var',
        value: 'x',
      }).success
    ).toBe(false);
  });

  it('rejects empty value', () => {
    expect(
      createVaultEntryRequestSchema.safeParse({
        scope: 'platform',
        name: 'K',
        credentialType: 'env_var',
        value: '',
      }).success
    ).toBe(false);
  });

  it('rejects unknown credentialType', () => {
    expect(
      createVaultEntryRequestSchema.safeParse({
        scope: 'platform',
        name: 'K',
        credentialType: 'exotic',
        value: 'x',
      }).success
    ).toBe(false);
  });
});

describe('vaultEntrySchema (response)', () => {
  it('accepts full row', () => {
    expect(vaultEntrySchema.parse(entry).credentialType).toBe('anthropic_api');
  });

  it('DOES NOT include encryptedValue even when someone sends it', () => {
    // Zod strips unknown keys in default parse mode.
    const withExtra = { ...entry, encryptedValue: 'enc:x' };
    const parsed = vaultEntrySchema.parse(withExtra);
    expect((parsed as Record<string, unknown>).encryptedValue).toBeUndefined();
  });

  it('accepts null injectionTarget / projectId / ownerId', () => {
    expect(
      vaultEntrySchema.parse({
        ...entry,
        projectId: null,
        ownerId: null,
        injectionTarget: null,
        scope: 'platform',
      }).injectionTarget
    ).toBeNull();
  });
});

describe('envelope schemas', () => {
  it('createVaultEntryResponseSchema wraps a single entry', () => {
    expect(createVaultEntryResponseSchema.parse({ data: entry }).data.id).toBeTruthy();
  });

  it('listVaultEntriesResponseSchema paginated shape', () => {
    expect(
      listVaultEntriesResponseSchema.parse({ data: [entry], nextCursor: null }).data
    ).toHaveLength(1);
  });

  it('listVaultEntriesQuerySchema accepts scope + projectId', () => {
    expect(
      listVaultEntriesQuerySchema.parse({
        scope: 'platform',
      }).scope
    ).toBe('platform');
  });

  it('deleteVaultEntryParamsSchema requires UUID', () => {
    expect(deleteVaultEntryParamsSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(
      deleteVaultEntryParamsSchema.parse({ id: '00000000-0000-0000-0000-000000000040' }).id
    ).toBeTruthy();
  });
});
