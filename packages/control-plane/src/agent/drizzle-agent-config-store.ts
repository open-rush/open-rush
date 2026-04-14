import { agents, type DbClient } from '@open-rush/db';
import { and, eq } from 'drizzle-orm';

import type { AgentConfig, AgentConfigStore } from './agent-config.js';

type AgentRow = typeof agents.$inferSelect;

function mapRow(row: AgentRow): AgentConfig {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    scope: row.isBuiltin ? 'builtin' : 'project',
    status: row.status as AgentConfig['status'],
    description: row.description,
    icon: row.icon,
    systemPrompt: row.systemPrompt,
    allowedTools: row.allowedTools ?? [],
    skills: row.skills ?? [],
    mcpServers: row.mcpServers ?? [],
    maxSteps: row.maxSteps,
    deliveryMode: row.deliveryMode as AgentConfig['deliveryMode'],
    isBuiltin: row.isBuiltin,
    createdBy: row.createdBy,
  };
}

export class DrizzleAgentConfigStore implements AgentConfigStore {
  constructor(private db: DbClient) {}

  async getBuiltinAgents(): Promise<AgentConfig[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.isBuiltin, true), eq(agents.status, 'active')));
    return rows.map(mapRow);
  }

  async getProjectAgents(projectId: string): Promise<AgentConfig[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')));
    return rows.map(mapRow);
  }

  async getById(id: string): Promise<AgentConfig | null> {
    const [row] = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    return row ? mapRow(row) : null;
  }

  async create(config: AgentConfig): Promise<AgentConfig> {
    if (!config.projectId) {
      throw new Error('projectId is required for persisted agents');
    }

    const [row] = await this.db
      .insert(agents)
      .values({
        id: config.id,
        projectId: config.projectId,
        status: config.status,
        name: config.name,
        description: config.description ?? null,
        icon: config.icon ?? null,
        providerType: 'claude-code',
        systemPrompt: config.systemPrompt ?? null,
        allowedTools: config.allowedTools ?? [],
        skills: config.skills ?? [],
        mcpServers: config.mcpServers ?? [],
        maxSteps: config.maxSteps ?? 30,
        deliveryMode: config.deliveryMode ?? 'chat',
        isBuiltin: config.isBuiltin ?? false,
        createdBy: config.createdBy ?? null,
      })
      .returning();
    return mapRow(row);
  }

  async update(id: string, update: Partial<AgentConfig>): Promise<AgentConfig | null> {
    const updates: Partial<typeof agents.$inferInsert> = {};

    if (update.name !== undefined) updates.name = update.name;
    if (update.description !== undefined) updates.description = update.description;
    if (update.icon !== undefined) updates.icon = update.icon;
    if (update.systemPrompt !== undefined) updates.systemPrompt = update.systemPrompt;
    if (update.allowedTools !== undefined) updates.allowedTools = update.allowedTools;
    if (update.skills !== undefined) updates.skills = update.skills;
    if (update.mcpServers !== undefined) updates.mcpServers = update.mcpServers;
    if (update.maxSteps !== undefined) updates.maxSteps = update.maxSteps;
    if (update.deliveryMode !== undefined) updates.deliveryMode = update.deliveryMode;
    if (update.status !== undefined) updates.status = update.status;
    if (update.isBuiltin !== undefined) updates.isBuiltin = update.isBuiltin;
    if (update.createdBy !== undefined) updates.createdBy = update.createdBy;

    updates.updatedAt = new Date();

    const [row] = await this.db.update(agents).set(updates).where(eq(agents.id, id)).returning();
    return row ? mapRow(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(agents)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    return !!row;
  }
}
