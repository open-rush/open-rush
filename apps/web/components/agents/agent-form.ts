import type { Agent } from '@rush/contracts';

export interface AgentFormState {
  name: string;
  description: string;
  providerType: 'claude-code' | 'gemini' | 'custom';
  model: string;
  systemPrompt: string;
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
  providerType: 'claude-code',
  model: '',
  systemPrompt: '',
  maxSteps: DEFAULT_AGENT_MAX_STEPS,
  deliveryMode: 'chat',
};

export function toAgentFormState(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    description: agent.description ?? '',
    providerType: agent.providerType,
    model: agent.model ?? '',
    systemPrompt: agent.systemPrompt ?? '',
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
  providerType: AgentFormState['providerType'];
  model: string | null;
  systemPrompt: string | null;
  maxSteps: number;
  deliveryMode: AgentFormState['deliveryMode'];
} {
  return {
    projectId,
    name: form.name.trim(),
    description: form.description.trim() || null,
    providerType: form.providerType,
    model: form.model.trim() || null,
    systemPrompt: form.systemPrompt.trim() || null,
    maxSteps: normalizeAgentMaxSteps(form.maxSteps),
    deliveryMode: form.deliveryMode,
  };
}
