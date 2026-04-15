import { McpRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(req: Request) {
  const userId = await requireAuth();
  const url = new URL(req.url);

  const SORT_WHITELIST = ['updated_at', 'star_count', 'name', 'created_at'] as const;
  const rawSort = url.searchParams.get('sortBy') ?? 'updated_at';
  const sortBy = SORT_WHITELIST.includes(rawSort as (typeof SORT_WHITELIST)[number])
    ? (rawSort as (typeof SORT_WHITELIST)[number])
    : 'updated_at';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const service = new McpRegistryService(getDbClient());
  const result = await service.list({
    search: url.searchParams.get('search') ?? undefined,
    transportType: url.searchParams.get('transportType') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
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

  if (!body.name?.trim() || !body.displayName?.trim()) {
    return apiError(400, 'INVALID_INPUT', 'name and displayName are required');
  }
  if (!body.transportType) {
    return apiError(400, 'INVALID_INPUT', 'transportType is required');
  }

  const service = new McpRegistryService(getDbClient());
  const mcp = await service.create({
    name: body.name,
    displayName: body.displayName,
    description: body.description ?? '',
    transportType: body.transportType,
    serverConfig: body.serverConfig ?? {},
    tools: body.tools,
    tags: body.tags,
    category: body.category,
    author: body.author,
    extraConfig: body.extraConfig,
    extraConfigMeta: body.extraConfigMeta,
    docUrl: body.docUrl,
    repoUrl: body.repoUrl,
    readme: body.readme,
    visibility: body.visibility,
    createdById: userId,
  });

  return apiSuccess(mcp, 201);
}
