import { type DbClient, skills } from '@lux/db';
import type { SkillConfig, SkillStore } from '@lux/skills';
import { and, eq } from 'drizzle-orm';

type SkillRow = typeof skills.$inferSelect;

function mapRow(row: SkillRow): SkillConfig {
  return {
    name: row.name,
    source: row.source,
    visibility: row.visibility as SkillConfig['visibility'],
    enabled: row.enabled,
  };
}

export class DrizzleSkillStore implements SkillStore {
  constructor(private db: DbClient) {}

  async getProjectSkills(projectId: string): Promise<SkillConfig[]> {
    const rows = await this.db
      .select()
      .from(skills)
      .where(eq(skills.projectId, projectId))
      .orderBy(skills.name);
    return rows.map(mapRow);
  }

  async addSkill(projectId: string, config: SkillConfig): Promise<void> {
    await this.db
      .insert(skills)
      .values({
        projectId,
        name: config.name,
        source: config.source,
        visibility: config.visibility,
        enabled: config.enabled,
      })
      .onConflictDoUpdate({
        target: [skills.projectId, skills.name],
        set: {
          source: config.source,
          visibility: config.visibility,
          enabled: config.enabled,
        },
      });
  }

  async removeSkill(projectId: string, skillName: string): Promise<boolean> {
    const rows = await this.db
      .delete(skills)
      .where(and(eq(skills.projectId, projectId), eq(skills.name, skillName)))
      .returning();
    return rows.length > 0;
  }

  async updateSkill(
    projectId: string,
    skillName: string,
    update: Partial<SkillConfig>
  ): Promise<boolean> {
    const set: Partial<typeof skills.$inferInsert> = {};
    if (update.source !== undefined) set.source = update.source;
    if (update.visibility !== undefined) set.visibility = update.visibility;
    if (update.enabled !== undefined) set.enabled = update.enabled;

    if (Object.keys(set).length === 0) return false;

    const rows = await this.db
      .update(skills)
      .set(set)
      .where(and(eq(skills.projectId, projectId), eq(skills.name, skillName)))
      .returning();
    return rows.length > 0;
  }
}
