import { z } from 'zod';
import { AgentDeliveryMode, AgentStatus } from './enums.js';

export const AgentConfig = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().default(null),
  icon: z.string().max(50).nullable().default(null),
  systemPrompt: z.string().max(20000).nullable().default(null),
  allowedTools: z.array(z.string().min(1)).default([]),
  skills: z.array(z.string().min(1)).default([]),
  mcpServers: z.array(z.string().min(1)).default([]),
  maxSteps: z.number().int().positive().max(100).default(30),
  deliveryMode: AgentDeliveryMode.default('chat'),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const Agent = AgentConfig.extend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: AgentStatus.default('active'),
  isBuiltin: z.boolean().default(false),
  customTitle: z.string().max(200).nullable().default(null),
  config: z.unknown().nullable().default(null),
  createdBy: z.string().uuid().nullable().default(null),
  activeStreamId: z.string().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lastActiveAt: z.coerce.date(),
});
export type Agent = z.infer<typeof Agent>;

export const CreateAgentRequest = AgentConfig.extend({
  projectId: z.string().uuid(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

export const UpdateAgentRequest = AgentConfig.partial();
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequest>;

export const ProjectAgent = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  isCurrent: z.boolean().default(false),
  configOverride: z.unknown().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProjectAgent = z.infer<typeof ProjectAgent>;

export const SetCurrentProjectAgentRequest = z.object({
  agentId: z.string().uuid(),
});
export type SetCurrentProjectAgentRequest = z.infer<typeof SetCurrentProjectAgentRequest>;
