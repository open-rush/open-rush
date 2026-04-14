import { randomUUID } from 'node:crypto';
import { DrizzleAgentConfigStore, ProjectAgentService } from '@open-rush/control-plane';
import type { DbClient } from '@open-rush/db';

const DEFAULT_AGENT = {
  name: 'Web Builder',
  description: 'Build and iterate on web applications in the project workspace.',
  systemPrompt:
    'You are a web development assistant. Help users build web applications using modern technologies. You can create, edit, and manage files in the project workspace.',
  maxSteps: 30,
  deliveryMode: 'workspace' as const,
};

export async function resolveAgentIdForProject(options: {
  db: DbClient;
  projectId: string;
  userId: string;
  requestedAgentId?: string | null;
}): Promise<string> {
  const { db, projectId, userId, requestedAgentId } = options;
  const agentStore = new DrizzleAgentConfigStore(db);
  const projectAgentService = new ProjectAgentService(db);

  if (requestedAgentId) {
    const existingAgent = await agentStore.getById(requestedAgentId);
    if (
      !existingAgent ||
      existingAgent.projectId !== projectId ||
      existingAgent.status !== 'active'
    ) {
      throw new Error('Agent does not belong to this project');
    }
    await projectAgentService.setCurrentAgent(projectId, requestedAgentId);
    return requestedAgentId;
  }

  const current = await projectAgentService.getCurrentAgent(projectId);
  if (current) {
    return current.agentId;
  }

  const projectAgents = await agentStore.getProjectAgents(projectId);
  if (projectAgents.length > 0) {
    const fallbackAgentId = projectAgents[0].id;
    await projectAgentService.setCurrentAgent(projectId, fallbackAgentId);
    return fallbackAgentId;
  }

  const createdAgent = await agentStore.create({
    id: randomUUID(),
    projectId,
    scope: 'project',
    status: 'active',
    name: DEFAULT_AGENT.name,
    description: DEFAULT_AGENT.description,
    systemPrompt: DEFAULT_AGENT.systemPrompt,
    maxSteps: DEFAULT_AGENT.maxSteps,
    deliveryMode: DEFAULT_AGENT.deliveryMode,
    createdBy: userId,
  });

  await projectAgentService.setCurrentAgent(projectId, createdAgent.id);
  return createdAgent.id;
}
