import { CreateRunRequest } from '@rush/contracts';
import {
  DrizzleAgentConfigStore,
  DrizzleRunDb,
  ProjectAgentService,
  RunService,
} from '@rush/control-plane';
import { getDbClient, projects } from '@rush/db';
import { eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';
import { getQueue } from '@/lib/queue';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  // Parse & validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateRunRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const { prompt, projectId, connectionMode, model, triggerSource } = parsed.data;
  let { agentId } = parsed.data;

  // Verify project exists and user has access
  const db = getDbClient();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    return apiError(404, 'PROJECT_NOT_FOUND', `Project ${projectId} not found`);
  }
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  // Resolve current agent for the project. We no longer auto-create placeholder agents.
  const store = new DrizzleAgentConfigStore(db);
  const projectAgentService = new ProjectAgentService(db);
  if (agentId) {
    const existingAgent = await store.getById(agentId);
    if (
      !existingAgent ||
      existingAgent.projectId !== projectId ||
      existingAgent.status !== 'active'
    ) {
      return apiError(400, 'INVALID_AGENT', 'Agent does not belong to this project');
    }

    await projectAgentService.setCurrentAgent(projectId, agentId);
  } else {
    const current = await projectAgentService.getCurrentAgent(projectId);
    if (!current) {
      return apiError(
        400,
        'MISSING_AGENT',
        'No agent selected for this project. Set a current agent first.'
      );
    }
    agentId = current.agentId;
  }

  if (!agentId) {
    return apiError(400, 'MISSING_AGENT', 'Unable to resolve an agent for this run');
  }

  // Create Run in DB
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);
  const run = await runService.createRun({
    agentId,
    prompt,
    connectionMode: connectionMode ?? undefined,
    modelId: model ?? undefined,
    triggerSource: triggerSource ?? undefined,
  });

  // Enqueue pg-boss job
  const queue = await getQueue();
  await queue.send('run/execute', {
    runId: run.id,
    prompt,
    agentId,
  });

  return apiSuccess({ runId: run.id, agentId, isNewAgent: false }, 201);
}
