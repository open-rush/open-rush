import { DrizzleSkillStore } from '@lux/control-plane';
import { getDbClient } from '@lux/db';
import { ReskillClient, SkillManager } from '@lux/skills';

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '@/lib/api-utils';

function getSkillManager() {
  const db = getDbClient();
  return new SkillManager(new ReskillClient(), new DrizzleSkillStore(db));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) return apiError(403, 'FORBIDDEN', 'No access to this project');

  const manager = getSkillManager();
  const skills = await manager.listProjectSkills(projectId);
  return apiSuccess(skills);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can manage skills');
  }

  let body: { skillRef?: string; visibility?: string };
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  if (!body.skillRef || typeof body.skillRef !== 'string') {
    return apiError(400, 'VALIDATION_ERROR', 'skillRef is required');
  }

  if (
    body.visibility !== undefined &&
    body.visibility !== 'public' &&
    body.visibility !== 'private'
  ) {
    return apiError(400, 'VALIDATION_ERROR', 'visibility must be public or private');
  }

  const manager = getSkillManager();
  await manager.installForProject(projectId, body.skillRef, {
    visibility: (body.visibility as 'public' | 'private') ?? 'public',
  });

  return apiSuccess({ installed: body.skillRef }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can manage skills');
  }

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return apiError(400, 'VALIDATION_ERROR', 'name query param is required');

  const manager = getSkillManager();
  try {
    await manager.uninstallFromProject(projectId, name);
  } catch {
    return apiError(404, 'NOT_FOUND', 'Skill not found');
  }
  return apiSuccess({ deleted: true });
}
