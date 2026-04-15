/**
 * POST /api/projects/[id]/skills/install-from-registry
 *
 * Bridge: installs a skill from the global registry into a project.
 * 1. Reads skill info from skill_registry
 * 2. Calls SkillManager.installForProject() to create project-level record
 * 3. Increments registry install_count
 */

import { DrizzleSkillStore, SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient, skillRegistry } from '@open-rush/db';
import { ReskillClient, SkillManager } from '@open-rush/skills';
import { eq, sql } from 'drizzle-orm';

import { apiError, apiSuccess, getProjectRole, requireAuth } from '@/lib/api-utils';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: projectId } = await params;

  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can install skills');
  }

  const body = await req.json().catch(() => null);
  if (!body?.skillName || typeof body.skillName !== 'string') {
    return apiError(400, 'INVALID_INPUT', 'skillName is required');
  }

  const db = getDbClient();
  const registryService = new SkillRegistryService(db);

  // 1. Verify skill exists in registry
  const registrySkill = await registryService.getByName(body.skillName);
  if (!registrySkill) {
    return apiError(404, 'NOT_FOUND', `Skill "${body.skillName}" not found in registry`);
  }

  // 2. Install into project via existing SkillManager
  const manager = new SkillManager(new ReskillClient(), new DrizzleSkillStore(db));
  await manager.installForProject(projectId, registrySkill.name, {
    visibility: (registrySkill.visibility as 'public' | 'private') ?? 'public',
  });

  // 3. Increment install count in registry
  await db
    .update(skillRegistry)
    .set({ installCount: sql`${skillRegistry.installCount} + 1` })
    .where(eq(skillRegistry.name, body.skillName));

  return apiSuccess(
    {
      installed: true,
      skillName: registrySkill.name,
      projectId,
    },
    201
  );
}
