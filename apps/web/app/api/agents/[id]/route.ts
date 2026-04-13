import { UpdateAgentRequest } from '@rush/contracts';
import { DrizzleAgentConfigStore, ProjectAgentService } from '@rush/control-plane';
import { agents, getDbClient, projectAgents } from '@rush/db';
import { and, eq } from 'drizzle-orm';

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const agent = await store.getById(id);
  if (!agent?.projectId) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  const hasAccess = await verifyProjectAccess(agent.projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this agent');
  }

  return apiSuccess(agent);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const existing = await store.getById(id);
  if (!existing?.projectId) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  const role = await getProjectRole(existing.projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can update agents');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = UpdateAgentRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const updated = await store.update(id, parsed.data);
  if (!updated) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  return apiSuccess(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const projectAgentService = new ProjectAgentService(db);
  const agent = await store.getById(id);
  if (!agent?.projectId) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  const role = await getProjectRole(agent.projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can delete agents');
  }

  const removed = await store.remove(id);
  if (!removed) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  const current = await projectAgentService.getCurrentAgent(agent.projectId);
  if (current?.agentId === id) {
    await db
      .update(projectAgents)
      .set({ isCurrent: false, updatedAt: new Date() })
      .where(and(eq(projectAgents.projectId, agent.projectId), eq(projectAgents.agentId, id)));

    const replacement = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.projectId, agent.projectId), eq(agents.status, 'active')))
      .limit(1);
    if (replacement[0]) {
      await projectAgentService.setCurrentAgent(agent.projectId, replacement[0].id);
    }
  }

  return apiSuccess({ deleted: true });
}
