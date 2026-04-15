/**
 * POST /api/projects/[id]/mcp/install-from-registry
 *
 * Bridge: installs an MCP server from the global registry into a project.
 * 1. Reads MCP config from mcp_registry
 * 2. Merges user-provided credentials into serverConfig template variables
 * 3. Calls McpRegistry.addServer('project', projectId, config) to create project-level record
 * 4. Records install in mcp_user_installs
 */

import { randomUUID } from 'node:crypto';
import { DrizzleMcpStore, McpRegistryService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import type { McpServerConfig } from '@open-rush/mcp';
import { McpRegistry } from '@open-rush/mcp';

import { apiError, apiSuccess, getProjectRole, requireAuth } from '@/lib/api-utils';
import { mergeExtraConfigIntoServerConfig } from '@/lib/mcps/install-utils';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  const { id: projectId } = await params;

  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can install MCP servers');
  }

  const body = await req.json().catch(() => null);
  if (!body?.mcpId || typeof body.mcpId !== 'string') {
    return apiError(400, 'INVALID_INPUT', 'mcpId is required');
  }

  const db = getDbClient();
  const registryService = new McpRegistryService(db);

  // 1. Get MCP from registry
  const registryMcp = await registryService.getById(body.mcpId);
  if (!registryMcp) {
    return apiError(404, 'NOT_FOUND', `MCP "${body.mcpId}" not found in registry`);
  }

  // 2. Merge user config into server config template variables
  const serverConfig =
    body.userConfig && typeof body.userConfig === 'object'
      ? mergeExtraConfigIntoServerConfig(
          registryMcp.transportType,
          registryMcp.serverConfig,
          body.userConfig as Record<string, string>
        )
      : registryMcp.serverConfig;

  // 3. Install into project via existing McpRegistry
  const mcpRegistry = new McpRegistry(new DrizzleMcpStore(db));
  const config: McpServerConfig = {
    id: randomUUID(),
    name: registryMcp.name,
    transport: registryMcp.transportType as 'stdio' | 'sse' | 'streamable-http',
    command: serverConfig.command as string | undefined,
    args: serverConfig.args as string[] | undefined,
    url: serverConfig.url as string | undefined,
    env: serverConfig.env as Record<string, string> | undefined,
    enabled: true,
    scope: 'project',
  };
  await mcpRegistry.addServer('project', projectId, config);

  // 4. Record install
  await registryService.install(body.mcpId, userId, body.userConfig);

  return apiSuccess(
    {
      installed: true,
      mcpName: registryMcp.name,
      projectId,
    },
    201
  );
}
