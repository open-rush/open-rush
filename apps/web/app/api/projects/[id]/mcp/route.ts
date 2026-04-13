import { randomUUID } from 'node:crypto';
import { DrizzleMcpStore } from '@lux/control-plane';
import { getDbClient } from '@lux/db';
import type { McpServerConfig } from '@lux/mcp';
import { McpRegistry } from '@lux/mcp';

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '@/lib/api-utils';

function getRegistry() {
  return new McpRegistry(new DrizzleMcpStore(getDbClient()));
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

  const registry = getRegistry();
  const servers = await registry.getServersForProject(projectId, userId);
  // Redact env values to prevent credential leakage
  const redacted = servers.map((s) => ({
    ...s,
    env: s.env ? Object.fromEntries(Object.keys(s.env).map((k) => [k, '***'])) : undefined,
  }));
  return apiSuccess(redacted);
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
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can manage MCP servers');
  }

  let body: Partial<McpServerConfig>;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  if (!body.name || !body.transport) {
    return apiError(400, 'VALIDATION_ERROR', 'name and transport are required');
  }
  const validTransports = ['stdio', 'sse', 'streamable-http'];
  if (!validTransports.includes(body.transport)) {
    return apiError(
      400,
      'VALIDATION_ERROR',
      `transport must be one of: ${validTransports.join(', ')}`
    );
  }
  if (body.transport === 'stdio' && !body.command) {
    return apiError(400, 'VALIDATION_ERROR', 'command is required for stdio transport');
  }
  if ((body.transport === 'sse' || body.transport === 'streamable-http') && !body.url) {
    return apiError(400, 'VALIDATION_ERROR', 'url is required for sse/streamable-http transport');
  }

  const config: McpServerConfig = {
    id: randomUUID(),
    name: body.name,
    transport: body.transport,
    command: body.command,
    args: body.args,
    url: body.url,
    env: body.env,
    enabled: body.enabled ?? true,
    scope: 'project',
  };

  const registry = getRegistry();
  await registry.addServer('project', projectId, config);
  return apiSuccess(config, 201);
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
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can manage MCP servers');
  }

  const url = new URL(request.url);
  const serverId = url.searchParams.get('serverId');
  if (!serverId) return apiError(400, 'VALIDATION_ERROR', 'serverId query param is required');

  const registry = getRegistry();
  try {
    await registry.removeServer('project', projectId, serverId);
  } catch {
    return apiError(404, 'NOT_FOUND', 'MCP server not found');
  }
  return apiSuccess({ deleted: true });
}
