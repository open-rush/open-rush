import type { AgentConfig } from '../agent/agent-config.js';

export interface AgentContext {
  agentConfig: AgentConfig;
  env: Record<string, string>;
  skills: string[];
  mcpServers: string[];
  systemPrompt: string;
}

export interface AgentExecutorDeps {
  resolveAgent(agentId: string, projectId: string): Promise<AgentConfig | null>;
  resolveVaultEnv(projectId: string): Promise<Record<string, string>>;
  resolveSkills(projectId: string): Promise<string[]>;
  resolveMcpServers(projectId: string): Promise<string[]>;
}

export class AgentExecutor {
  constructor(private deps: AgentExecutorDeps) {}

  async prepareContext(agentId: string, projectId: string): Promise<AgentContext> {
    const agentConfig = await this.deps.resolveAgent(agentId, projectId);
    if (!agentConfig) throw new Error(`Agent '${agentId}' not found`);

    const [env, skills, mcpServers] = await Promise.all([
      this.deps.resolveVaultEnv(projectId),
      this.deps.resolveSkills(projectId),
      this.deps.resolveMcpServers(projectId),
    ]);

    const filteredSkills = agentConfig.skills?.length
      ? skills.filter((s) => agentConfig.skills?.includes(s))
      : skills;

    const filteredMcp = agentConfig.mcpServers?.length
      ? mcpServers.filter((s) => agentConfig.mcpServers?.includes(s))
      : mcpServers;

    return {
      agentConfig,
      env,
      skills: filteredSkills,
      mcpServers: filteredMcp,
      systemPrompt: agentConfig.systemPrompt ?? '',
    };
  }
}
