export type AgentScope = 'builtin' | 'project';

export interface AgentConfig {
  id: string;
  projectId: string | null;
  name: string;
  scope: AgentScope;
  status: 'active' | 'inactive';
  description?: string | null;
  icon?: string | null;
  systemPrompt: string | null;
  mcpServers?: string[];
  skills?: string[];
  allowedTools?: string[];
  maxSteps?: number;
  deliveryMode?: 'chat' | 'workspace';
  isBuiltin?: boolean;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AgentConfigStore {
  getBuiltinAgents(): Promise<AgentConfig[]>;
  getProjectAgents(projectId: string): Promise<AgentConfig[]>;
  getById(id: string): Promise<AgentConfig | null>;
  create(config: AgentConfig): Promise<AgentConfig>;
  update(id: string, update: Partial<AgentConfig>): Promise<AgentConfig | null>;
  remove(id: string): Promise<boolean>;
}

const BUILTIN_AGENTS: AgentConfig[] = [
  {
    id: 'web-builder',
    projectId: null,
    name: 'Web Builder',
    scope: 'builtin',
    status: 'active',
    description: 'Build and iterate on web applications in the project workspace.',
    icon: 'code',
    systemPrompt:
      'You are a web development assistant. Help users build web applications using modern technologies. You can create, edit, and manage files in the project workspace.',
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    skills: [],
    mcpServers: [],
    maxSteps: 30,
    deliveryMode: 'workspace',
    isBuiltin: true,
  },
];

export class AgentRegistry {
  constructor(private store: AgentConfigStore) {}

  async getAgentsForProject(projectId: string): Promise<AgentConfig[]> {
    const [builtin, project] = await Promise.all([
      this.store.getBuiltinAgents(),
      this.store.getProjectAgents(projectId),
    ]);

    const merged = new Map<string, AgentConfig>();
    for (const a of builtin) merged.set(a.id, a);
    for (const a of project) merged.set(a.id, a);

    return Array.from(merged.values());
  }

  async getById(id: string): Promise<AgentConfig | null> {
    return this.store.getById(id);
  }

  async createAgent(config: AgentConfig): Promise<AgentConfig> {
    if (config.scope === 'builtin') {
      throw new Error('Cannot create builtin agents');
    }
    return this.store.create(config);
  }

  async updateAgent(id: string, update: Partial<AgentConfig>): Promise<AgentConfig> {
    if (update.scope === 'builtin') {
      throw new Error('Cannot change agent scope to builtin');
    }
    const updated = await this.store.update(id, update);
    if (!updated) throw new Error('Agent not found');
    return updated;
  }

  async removeAgent(id: string): Promise<void> {
    const agent = await this.store.getById(id);
    if (agent?.scope === 'builtin') {
      throw new Error('Cannot remove builtin agents');
    }
    const removed = await this.store.remove(id);
    if (!removed) throw new Error('Agent not found');
  }

  async resolveConfig(agentId: string, projectId: string): Promise<AgentConfig | null> {
    const agents = await this.getAgentsForProject(projectId);
    return agents.find((a) => a.id === agentId) ?? null;
  }

  getBuiltinAgents(): AgentConfig[] {
    return [...BUILTIN_AGENTS];
  }
}
