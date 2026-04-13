import { SetCurrentProjectAgentRequest } from '@rush/contracts';
import { DrizzleAgentConfigStore, ProjectAgentService } from '@rush/control-plane';
import { getDbClient } from '@rush/db';

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

  const { id: projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  const db = getDbClient();
  const projectAgentService = new ProjectAgentService(db);
  const store = new DrizzleAgentConfigStore(db);
  const binding = await projectAgentService.getCurrentAgent(projectId);
  if (!binding) {
    return apiSuccess({ currentAgent: null });
  }

  const agent = await store.getById(binding.agentId);
  return apiSuccess({ currentAgent: agent, binding });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can change current agent');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = SetCurrentProjectAgentRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const db = getDbClient();
  const projectAgentService = new ProjectAgentService(db);
  const store = new DrizzleAgentConfigStore(db);

  try {
    const binding = await projectAgentService.setCurrentAgent(projectId, parsed.data.agentId);
    const agent = await store.getById(parsed.data.agentId);
    return apiSuccess({ currentAgent: agent, binding });
  } catch (error) {
    return apiError(400, 'INVALID_AGENT', error instanceof Error ? error.message : 'Invalid agent');
  }
}
