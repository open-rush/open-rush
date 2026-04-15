/**
 * GET /api/skills/[id]/skill-md
 *
 * Returns SKILL.md content for a skill. If not cached in DB, fetches from
 * source URL and stores it (lazy backfill).
 */

import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';
import { sourceUrlToSkillMdRawUrl } from '@/lib/skills/skill-md-utils';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id: name } = await params;
  const decodedName = decodeURIComponent(name);

  const service = new SkillRegistryService(getDbClient());
  const skill = await service.getByName(decodedName);
  if (!skill) return apiError(404, 'NOT_FOUND', 'Skill not found');

  if (skill.skillMdContent) {
    return apiSuccess({ content: skill.skillMdContent });
  }

  // Lazy backfill: fetch from source URL
  if (skill.sourceUrl) {
    const content = await fetchSkillMdFromSourceUrl(skill.sourceUrl, skill.sourceType);
    if (content) {
      await service.update(decodedName, { skillMdContent: content });
      return apiSuccess({ content });
    }
  }

  return apiSuccess({ content: null });
}

async function fetchSkillMdFromSourceUrl(
  sourceUrl: string,
  sourceType?: string
): Promise<string | null> {
  try {
    const rawUrl = sourceUrlToSkillMdRawUrl(sourceUrl, sourceType);
    if (!rawUrl) return null;
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'OpenRush-Skill-Parser' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.text()) || null;
  } catch {
    return null;
  }
}
