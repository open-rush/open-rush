import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReskillClient, SearchResult } from '../reskill-client.js';
import { type SkillConfig, SkillManager, type SkillStore } from '../skill-manager.js';

class MockReskillClient
  implements Pick<ReskillClient, 'search' | 'install' | 'uninstall' | 'list'>
{
  installed: string[] = [];

  async search(_query: string): Promise<SearchResult[]> {
    return [
      {
        name: 'commit',
        description: 'Git commit skill',
        source: '@example/commit',
        version: '1.0.0',
      },
      {
        name: 'review',
        description: 'Code review skill',
        source: '@example/review',
        version: '2.0.0',
      },
    ];
  }

  async install(skillRef: string): Promise<void> {
    this.installed.push(skillRef);
  }

  async uninstall(skillName: string): Promise<void> {
    this.installed = this.installed.filter((s) => s !== skillName);
  }

  async list() {
    return this.installed.map((s) => ({ name: s, source: s }));
  }
}

class InMemorySkillStore implements SkillStore {
  private skills = new Map<string, SkillConfig[]>();

  async getProjectSkills(projectId: string): Promise<SkillConfig[]> {
    return this.skills.get(projectId) ?? [];
  }

  async addSkill(projectId: string, config: SkillConfig): Promise<void> {
    const skills = this.skills.get(projectId) ?? [];
    skills.push(config);
    this.skills.set(projectId, skills);
  }

  async removeSkill(projectId: string, skillName: string): Promise<boolean> {
    const skills = this.skills.get(projectId) ?? [];
    const idx = skills.findIndex((s) => s.name === skillName);
    if (idx === -1) return false;
    skills.splice(idx, 1);
    return true;
  }

  async updateSkill(
    projectId: string,
    skillName: string,
    update: Partial<SkillConfig>
  ): Promise<boolean> {
    const skills = this.skills.get(projectId) ?? [];
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) return false;
    Object.assign(skill, update);
    return true;
  }
}

describe('SkillManager', () => {
  let reskill: MockReskillClient;
  let store: InMemorySkillStore;
  let manager: SkillManager;
  const projectId = randomUUID();

  beforeEach(() => {
    reskill = new MockReskillClient();
    store = new InMemorySkillStore();
    manager = new SkillManager(reskill as unknown as ReskillClient, store);
  });

  describe('search', () => {
    it('returns search results from reskill', async () => {
      const results = await manager.search('commit');
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('commit');
    });
  });

  describe('installForProject', () => {
    it('installs via reskill and saves to store', async () => {
      await manager.installForProject(projectId, '@example/commit');
      expect(reskill.installed).toContain('@example/commit');
      const skills = await manager.listProjectSkills(projectId);
      expect(skills).toHaveLength(1);
      expect(skills[0].enabled).toBe(true);
    });

    it('uses claude-code as default agent', async () => {
      const installSpy = vi.spyOn(reskill, 'install');
      await manager.installForProject(projectId, '@example/commit');
      expect(installSpy).toHaveBeenCalledWith('@example/commit', { agents: ['claude-code'] });
    });

    it('supports custom agents', async () => {
      const installSpy = vi.spyOn(reskill, 'install');
      await manager.installForProject(projectId, '@example/commit', {
        agents: ['claude-code', 'cursor'],
      });
      expect(installSpy).toHaveBeenCalledWith('@example/commit', {
        agents: ['claude-code', 'cursor'],
      });
    });

    it('skips duplicate install (idempotent)', async () => {
      await manager.installForProject(projectId, '@example/commit');
      await manager.installForProject(projectId, '@example/commit');
      const skills = await manager.listProjectSkills(projectId);
      expect(skills).toHaveLength(1);
    });
  });

  describe('uninstallFromProject', () => {
    it('removes from store and calls reskill uninstall', async () => {
      const uninstallSpy = vi.spyOn(reskill, 'uninstall');
      await manager.installForProject(projectId, '@example/commit');
      await manager.uninstallFromProject(projectId, '@example/commit');
      const skills = await manager.listProjectSkills(projectId);
      expect(skills).toHaveLength(0);
      expect(uninstallSpy).toHaveBeenCalledWith('@example/commit');
    });

    it('throws for non-existent skill', async () => {
      await expect(manager.uninstallFromProject(projectId, 'nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('enable/disable', () => {
    it('disables a skill', async () => {
      await manager.installForProject(projectId, '@example/commit');
      await manager.disableSkill(projectId, '@example/commit');
      const skills = await manager.listProjectSkills(projectId);
      expect(skills[0].enabled).toBe(false);
    });

    it('re-enables a disabled skill', async () => {
      await manager.installForProject(projectId, '@example/commit');
      await manager.disableSkill(projectId, '@example/commit');
      await manager.enableSkill(projectId, '@example/commit');
      const skills = await manager.listProjectSkills(projectId);
      expect(skills[0].enabled).toBe(true);
    });

    it('getEnabledSkills filters disabled', async () => {
      await manager.installForProject(projectId, '@example/commit');
      await manager.installForProject(projectId, '@example/review');
      await manager.disableSkill(projectId, '@example/commit');
      const enabled = await manager.getEnabledSkills(projectId);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('@example/review');
    });
  });

  describe('resolveForAgent', () => {
    it('returns sources of enabled skills', async () => {
      await manager.installForProject(projectId, '@example/commit');
      await manager.installForProject(projectId, '@example/review');
      const refs = await manager.resolveForAgent(projectId);
      expect(refs).toEqual(['@example/commit', '@example/review']);
    });

    it('excludes disabled skills', async () => {
      await manager.installForProject(projectId, '@example/commit');
      await manager.installForProject(projectId, '@example/review');
      await manager.disableSkill(projectId, '@example/commit');
      const refs = await manager.resolveForAgent(projectId);
      expect(refs).toEqual(['@example/review']);
    });
  });
});
