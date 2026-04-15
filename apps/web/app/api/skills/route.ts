import { SkillRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';
import {
  extractDescriptionFromFrontmatter,
  sourceUrlToSkillMdRawUrl,
} from '@/lib/skills/skill-md-utils';

export async function GET(req: Request) {
  const userId = await requireAuth();
  const url = new URL(req.url);

  const SORT_WHITELIST = ['updated_at', 'star_count', 'install_count', 'name'] as const;
  const rawSort = url.searchParams.get('sortBy') ?? 'updated_at';
  const sortBy = SORT_WHITELIST.includes(rawSort as (typeof SORT_WHITELIST)[number])
    ? (rawSort as (typeof SORT_WHITELIST)[number])
    : 'updated_at';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const service = new SkillRegistryService(getDbClient());
  const result = await service.list({
    search: url.searchParams.get('search') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    visibility: url.searchParams.get('visibility') ?? undefined,
    sortBy,
    limit,
    offset,
    userId,
  });

  return apiSuccess({ items: result.items, total: result.total, limit, offset });
}

export async function POST(req: Request) {
  const userId = await requireAuth();
  const body = await req.json().catch(() => null);
  if (!body) return apiError(400, 'INVALID_INPUT', 'Invalid JSON body');

  if (!body.name?.trim()) {
    return apiError(400, 'INVALID_INPUT', 'name is required');
  }

  // If no skillMdContent provided but has sourceUrl, try to fetch SKILL.md
  let skillMdContent = body.skillMdContent ?? null;
  if (!skillMdContent && body.sourceUrl) {
    skillMdContent = await fetchSkillMdFromSourceUrl(body.sourceUrl, body.sourceType);
  }

  // Parse description from SKILL.md frontmatter if not provided
  let description = body.description ?? '';
  if (!description && skillMdContent) {
    description = extractDescriptionFromFrontmatter(skillMdContent) ?? '';
  }

  const service = new SkillRegistryService(getDbClient());
  const skill = await service.create({
    name: body.name,
    description,
    sourceType: body.sourceType,
    sourceUrl: body.sourceUrl,
    category: body.category,
    tags: body.tags,
    visibility: body.visibility,
    skillMdContent,
    license: body.license,
    groupId: body.groupId,
    createdById: userId,
  });

  return apiSuccess(skill, 201);
}

// ---------------------------------------------------------------------------
// SKILL.md fetch from remote URL
// ---------------------------------------------------------------------------

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
