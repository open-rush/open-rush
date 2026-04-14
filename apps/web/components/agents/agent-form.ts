import type { Agent } from '@open-rush/contracts';

export interface AgentFormState {
  name: string;
  description: string;
  systemPrompt: string;
  skills: string[];
  mcpServers: string[];
  maxSteps: number;
  deliveryMode: 'chat' | 'workspace';
}

export type AgentFormChangeHandler = <K extends keyof AgentFormState>(
  key: K,
  value: AgentFormState[K]
) => void;

export const DEFAULT_AGENT_MAX_STEPS = 30;

export const EMPTY_AGENT_FORM: AgentFormState = {
  name: '',
  description: '',
  systemPrompt: '',
  skills: [],
  mcpServers: [],
  maxSteps: DEFAULT_AGENT_MAX_STEPS,
  deliveryMode: 'chat',
};

export function toAgentFormState(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt ?? '',
    skills: agent.skills ?? [],
    mcpServers: agent.mcpServers ?? [],
    maxSteps: agent.maxSteps,
    deliveryMode: agent.deliveryMode,
  };
}

export function normalizeAgentMaxSteps(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AGENT_MAX_STEPS;
  }

  return Math.min(100, Math.max(1, Math.trunc(value)));
}

export function toAgentPayload(
  projectId: string,
  form: AgentFormState
): {
  projectId: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  skills: string[];
  mcpServers: string[];
  maxSteps: number;
  deliveryMode: AgentFormState['deliveryMode'];
} {
  return {
    projectId,
    name: form.name.trim(),
    description: form.description.trim() || null,
    systemPrompt: form.systemPrompt.trim() || null,
    skills: form.skills.filter((s) => s.trim()),
    mcpServers: form.mcpServers.filter((s) => s.trim()),
    maxSteps: normalizeAgentMaxSteps(form.maxSteps),
    deliveryMode: form.deliveryMode,
  };
}
