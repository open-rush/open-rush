import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: name } = await params;

  const service = new SkillRegistryService(getDbClient());
  const skill = await service.getByName(decodeURIComponent(name), userId);
  if (!skill) return apiError(404, 'NOT_FOUND', 'Skill not found');

  return apiSuccess(skill);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: name } = await params;
  const decodedName = decodeURIComponent(name);
  const body = await req.json().catch(() => null);
  if (!body) return apiError(400, 'INVALID_INPUT', 'Invalid JSON body');

  const service = new SkillRegistryService(getDbClient());
  const role = await service.checkWriteAccess(decodedName, userId);
  if (!role) return apiError(403, 'FORBIDDEN', 'You do not have write access to this skill');

  const updated = await service.update(decodedName, body);
  if (!updated) return apiError(404, 'NOT_FOUND', 'Skill not found');

  return apiSuccess(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: name } = await params;
  const decodedName = decodeURIComponent(name);

  const service = new SkillRegistryService(getDbClient());
  const role = await service.checkWriteAccess(decodedName, userId);
  if (role !== 'owner') return apiError(403, 'FORBIDDEN', 'Only the owner can delete a skill');

  const deleted = await service.remove(decodedName);
  if (!deleted) return apiError(404, 'NOT_FOUND', 'Skill not found');

  return apiSuccess({ deleted: true });
}
