/**
 * Chat Start API — POST /api/chat/start
 *
 * One-step: auto-creates default project (if needed) + conversation.
 * Returns { projectId, conversationId } so the frontend can start chatting.
 */

import { ConversationService, DrizzleConversationDb } from '@rush/control-plane';
import { getDbClient, projects } from '@rush/db';
import { and, eq, isNull } from 'drizzle-orm';
import { resolveAgentIdForProject } from '@/lib/agents/resolve-agent-id';
import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

const DEFAULT_PROJECT_NAME = 'My Project';

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const db = getDbClient();
  let projectId: string | undefined;
  let agentId: string | undefined;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      projectId?: string;
      agentId?: string;
    };
    projectId = body.projectId;
    agentId = body.agentId;
  } catch {
    // Ignore invalid optional body and fall back to default project behavior.
  }

  // 1. Get or create default project
  let project: { id: string } | undefined;

  if (projectId) {
    const hasAccess = await verifyProjectAccess(projectId, userId);
    if (!hasAccess) {
      return apiError(403, 'FORBIDDEN', 'No access to this project');
    }
    project = { id: projectId };
  } else {
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.createdBy, userId), isNull(projects.deletedAt)))
      .orderBy(projects.createdAt)
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(projects)
        .values({ name: DEFAULT_PROJECT_NAME, createdBy: userId })
        .returning({ id: projects.id });

      if (!created) {
        return apiError(500, 'INTERNAL_ERROR', 'Failed to create project');
      }
      project = created;
    } else {
      project = existing;
    }
  }

  try {
    agentId = await resolveAgentIdForProject({
      db,
      projectId: project.id,
      userId,
      requestedAgentId: agentId,
    });
  } catch (error) {
    return apiError(400, 'INVALID_AGENT', error instanceof Error ? error.message : 'Invalid agent');
  }

  // 2. Create conversation
  const service = new ConversationService(new DrizzleConversationDb(db));
  const conversation = await service.create({
    projectId: project.id,
    userId,
    agentId,
  });

  return apiSuccess({
    projectId: project.id,
    conversationId: conversation.id,
  });
}
