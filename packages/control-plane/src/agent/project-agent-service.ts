import type { ProjectAgent as ProjectAgentContract } from '@rush/contracts';
import { agents, type DbClient, projectAgents } from '@rush/db';
import { and, asc, eq } from 'drizzle-orm';

type ProjectAgentRow = typeof projectAgents.$inferSelect;

function mapRow(row: ProjectAgentRow): ProjectAgentContract {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    isCurrent: row.isCurrent,
    configOverride: row.configOverride,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProjectAgentService {
  constructor(private db: DbClient) {}

  async listByProject(projectId: string): Promise<ProjectAgentContract[]> {
    const rows = await this.db
      .select()
      .from(projectAgents)
      .where(eq(projectAgents.projectId, projectId))
      .orderBy(asc(projectAgents.createdAt));
    return rows.map(mapRow);
  }

  async getCurrentAgent(projectId: string): Promise<ProjectAgentContract | null> {
    const [row] = await this.db
      .select()
      .from(projectAgents)
      .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.isCurrent, true)))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async getProjectAgent(projectId: string, agentId: string): Promise<ProjectAgentContract | null> {
    const [row] = await this.db
      .select()
      .from(projectAgents)
      .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId)))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async setCurrentAgent(
    projectId: string,
    agentId: string,
    configOverride?: unknown
  ): Promise<ProjectAgentContract> {
    return this.db.transaction(async (tx) => {
      const [agent] = await tx
        .select()
        .from(agents)
        .where(
          and(eq(agents.id, agentId), eq(agents.projectId, projectId), eq(agents.status, 'active'))
        )
        .limit(1);
      if (!agent) {
        throw new Error('Agent not found in project');
      }

      const now = new Date();
      await tx
        .update(projectAgents)
        .set({ isCurrent: false, updatedAt: now })
        .where(eq(projectAgents.projectId, projectId));

      const values: typeof projectAgents.$inferInsert = {
        projectId,
        agentId,
        isCurrent: true,
        updatedAt: now,
      };
      if (configOverride !== undefined) {
        values.configOverride = configOverride;
      }

      const [row] = await tx
        .insert(projectAgents)
        .values(values)
        .onConflictDoUpdate({
          target: [projectAgents.projectId, projectAgents.agentId],
          set: {
            isCurrent: true,
            updatedAt: now,
            ...(configOverride !== undefined ? { configOverride } : {}),
          },
        })
        .returning();

      return mapRow(row);
    });
  }
}
