import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AgentConfig, type AgentConfigStore, AgentRegistry } from '../agent/agent-config.js';

class InMemoryAgentStore implements AgentConfigStore {
  private agents = new Map<string, AgentConfig>();

  async getBuiltinAgents(): Promise<AgentConfig[]> {
    return Array.from(this.agents.values()).filter((a) => a.scope === 'builtin');
  }

  async getProjectAgents(projectId: string): Promise<AgentConfig[]> {
    return Array.from(this.agents.values()).filter(
      (a) => a.scope === 'project' && a.projectId === projectId
    );
  }

  async getById(id: string): Promise<AgentConfig | null> {
    return this.agents.get(id) ?? null;
  }

  async create(config: AgentConfig): Promise<AgentConfig> {
    this.agents.set(config.id, config);
    return config;
  }

  async update(id: string, update: Partial<AgentConfig>): Promise<AgentConfig | null> {
    const agent = this.agents.get(id);
    if (!agent) return null;
    Object.assign(agent, update);
    return agent;
  }

  async remove(id: string): Promise<boolean> {
    return this.agents.delete(id);
  }
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    name: 'Test Agent',
    scope: 'project',
    status: 'active',
    systemPrompt: 'You are a test agent.',
    maxSteps: 30,
    deliveryMode: 'chat',
    ...overrides,
  };
}

describe('AgentRegistry', () => {
  let store: InMemoryAgentStore;
  let registry: AgentRegistry;
  const projectId = randomUUID();

  beforeEach(() => {
    store = new InMemoryAgentStore();
    registry = new AgentRegistry(store);
  });

  describe('getBuiltinAgents', () => {
    it('returns web-builder as builtin', () => {
      const builtins = registry.getBuiltinAgents();
      expect(builtins).toHaveLength(1);
      expect(builtins[0].id).toBe('web-builder');
    });
  });

  describe('createAgent', () => {
    it('creates project agent', async () => {
      const config = makeAgent({ projectId });
      const created = await registry.createAgent(config);
      expect(created.id).toBe(config.id);
    });

    it('rejects creating builtin agent', async () => {
      await expect(registry.createAgent(makeAgent({ scope: 'builtin' }))).rejects.toThrow(
        'Cannot create builtin'
      );
    });
  });

  describe('updateAgent', () => {
    it('updates agent config', async () => {
      const config = makeAgent();
      await registry.createAgent(config);
      const updated = await registry.updateAgent(config.id, { name: 'Renamed Agent' });
      expect(updated.name).toBe('Renamed Agent');
    });

    it('rejects changing to builtin scope', async () => {
      const config = makeAgent();
      await registry.createAgent(config);
      await expect(registry.updateAgent(config.id, { scope: 'builtin' })).rejects.toThrow(
        'Cannot change agent scope to builtin'
      );
    });
  });

  describe('removeAgent', () => {
    it('removes agent', async () => {
      const config = makeAgent();
      await registry.createAgent(config);
      await registry.removeAgent(config.id);
      expect(await registry.getById(config.id)).toBeNull();
    });

    it('throws for non-existent', async () => {
      await expect(registry.removeAgent(randomUUID())).rejects.toThrow('not found');
    });
  });

  describe('getAgentsForProject', () => {
    it('merges builtin + project', async () => {
      await store.create(makeAgent({ id: 'web-builder', scope: 'builtin' }));
      await store.create(makeAgent({ id: 'p1', scope: 'project', projectId }));

      const agents = await registry.getAgentsForProject(projectId);
      expect(agents).toHaveLength(2);
    });

    it('project overrides builtin with same id', async () => {
      await store.create(makeAgent({ id: 'web-builder', scope: 'builtin', name: 'Web Builder' }));
      await store.create(
        makeAgent({
          id: 'web-builder',
          scope: 'project',
          name: 'Custom Builder',
          projectId,
        })
      );

      const agents = await registry.getAgentsForProject(projectId);
      const wb = agents.find((a) => a.id === 'web-builder');
      expect(wb?.name).toBe('Custom Builder');
    });
  });

  describe('resolveConfig', () => {
    it('finds agent by id in project context', async () => {
      await store.create(makeAgent({ id: 'my-agent', projectId }));
      const resolved = await registry.resolveConfig('my-agent', projectId);
      expect(resolved?.id).toBe('my-agent');
    });

    it('returns null for unknown agent', async () => {
      expect(await registry.resolveConfig('nonexistent', projectId)).toBeNull();
    });
  });
});
