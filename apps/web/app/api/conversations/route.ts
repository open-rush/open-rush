import { ConversationService, DrizzleConversationDb } from '@rush/control-plane';
import { getDbClient } from '@rush/db';
import { resolveAgentIdForProject } from '@/lib/agents/resolve-agent-id';
import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) {
    return apiError(400, 'VALIDATION_ERROR', 'projectId query parameter is required');
  }

  const rawLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const db = getDbClient();
  const service = new ConversationService(new DrizzleConversationDb(db));
  const conversations = await service.listByProject(projectId, limit);

  return apiSuccess(conversations);
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

  const { projectId, agentId, title } = body as Record<string, string>;
  if (!projectId) {
    return apiError(400, 'VALIDATION_ERROR', 'projectId is required');
  }

  const db = getDbClient();
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  let resolvedAgentId: string;
  try {
    resolvedAgentId = await resolveAgentIdForProject({
      db,
      projectId,
      userId,
      requestedAgentId: agentId,
    });
  } catch (error) {
    return apiError(400, 'INVALID_AGENT', error instanceof Error ? error.message : 'Invalid agent');
  }

  const service = new ConversationService(new DrizzleConversationDb(db));
  const conversation = await service.create({
    projectId,
    userId,
    agentId: resolvedAgentId,
    title,
  });

  return apiSuccess(conversation, 201);
}
