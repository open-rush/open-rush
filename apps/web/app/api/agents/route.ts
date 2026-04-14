import { randomUUID } from 'node:crypto';
import { CreateAgentRequest } from '@open-rush/contracts';
import { DrizzleAgentConfigStore, ProjectAgentService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '@/lib/api-utils';

export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return apiError(400, 'VALIDATION_ERROR', 'projectId query parameter is required');
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const agents = await store.getProjectAgents(projectId);
  return apiSuccess(agents);
}

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateAgentRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const { projectId } = parsed.data;
  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can create agents');
  }

  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const projectAgentService = new ProjectAgentService(db);

  const agent = await store.create({
    id: randomUUID(),
    projectId,
    scope: 'project',
    status: 'active',
    name: parsed.data.name,
    description: parsed.data.description,
    icon: parsed.data.icon,
    systemPrompt: parsed.data.systemPrompt,
    allowedTools: parsed.data.allowedTools,
    skills: parsed.data.skills,
    mcpServers: parsed.data.mcpServers,
    maxSteps: parsed.data.maxSteps,
    deliveryMode: parsed.data.deliveryMode,
    createdBy: userId,
  });

  const current = await projectAgentService.getCurrentAgent(projectId);
  if (!current) {
    await projectAgentService.setCurrentAgent(projectId, agent.id);
  }

  return apiSuccess(agent, 201);
}
