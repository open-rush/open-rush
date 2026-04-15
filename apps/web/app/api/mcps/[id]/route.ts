import { McpRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;

  const service = new McpRegistryService(getDbClient());
  const mcp = await service.getById(id, userId);
  if (!mcp) return apiError(404, 'NOT_FOUND', 'MCP server not found');

  return apiSuccess(mcp);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return apiError(400, 'INVALID_INPUT', 'Invalid JSON body');

  const service = new McpRegistryService(getDbClient());
  const role = await service.checkWriteAccess(id, userId);
  if (!role) return apiError(403, 'FORBIDDEN', 'You do not have write access to this MCP server');

  const updated = await service.update(id, body);
  if (!updated) return apiError(404, 'NOT_FOUND', 'MCP server not found');

  return apiSuccess(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id } = await params;

  const service = new McpRegistryService(getDbClient());
  const role = await service.checkWriteAccess(id, userId);
  if (role !== 'owner')
    return apiError(403, 'FORBIDDEN', 'Only the owner can delete an MCP server');

  const deleted = await service.remove(id);
  if (!deleted) return apiError(404, 'NOT_FOUND', 'MCP server not found');

  return apiSuccess({ deleted: true });
}
