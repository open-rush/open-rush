import { describe, expect, it } from 'vitest';
import * as v1 from '../index.js';

describe('v1 barrel export', () => {
  it('re-exports common schemas', () => {
    expect(typeof v1.errorResponseSchema).toBe('object');
    expect(typeof v1.ErrorCode).toBe('object');
    expect(typeof v1.ServiceTokenScope).toBe('object');
  });

  it('re-exports 24 endpoint schemas (spot-check)', () => {
    // Auth
    expect(typeof v1.createTokenRequestSchema).toBe('object');
    expect(typeof v1.listTokensResponseSchema).toBe('object');
    expect(typeof v1.deleteTokenParamsSchema).toBe('object');
    // AgentDefinition
    expect(typeof v1.createAgentDefinitionRequestSchema).toBe('object');
    expect(typeof v1.patchAgentDefinitionRequestSchema).toBe('object');
    expect(typeof v1.listAgentDefinitionVersionsResponseSchema).toBe('object');
    expect(typeof v1.archiveAgentDefinitionResponseSchema).toBe('object');
    // Agent
    expect(typeof v1.createAgentRequestSchema).toBe('object');
    expect(typeof v1.deleteAgentResponseSchema).toBe('object');
    // Run
    expect(typeof v1.createRunRequestSchema).toBe('object');
    expect(typeof v1.cancelRunResponseSchema).toBe('object');
    expect(typeof v1.runEventSseFrameSchema).toBe('object');
    // Vault
    expect(typeof v1.createVaultEntryRequestSchema).toBe('object');
    expect(typeof v1.listVaultEntriesResponseSchema).toBe('object');
    // Registry
    expect(typeof v1.listSkillsResponseSchema).toBe('object');
    expect(typeof v1.listMcpsResponseSchema).toBe('object');
    // Projects
    expect(typeof v1.createProjectRequestSchema).toBe('object');
    expect(typeof v1.getProjectResponseSchema).toBe('object');
  });

  it('re-exports Open-rush extension event part schemas (4)', () => {
    expect(typeof v1.openrushRunStartedPartSchema).toBe('object');
    expect(typeof v1.openrushRunDonePartSchema).toBe('object');
    expect(typeof v1.openrushUsagePartSchema).toBe('object');
    expect(typeof v1.openrushSubRunPartSchema).toBe('object');
    expect(typeof v1.openrushExtensionPartSchema).toBe('object');
  });
});
