import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { projects } from './projects.js';

export const projectAgents = pgTable(
  'project_agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    isCurrent: boolean('is_current').notNull().default(false),
    configOverride: jsonb('config_override'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('project_agents_project_agent_idx').on(t.projectId, t.agentId),
    index('project_agents_project_id_idx').on(t.projectId),
    index('project_agents_agent_id_idx').on(t.agentId),
    uniqueIndex('project_agents_current_idx').on(t.projectId).where(sql`${t.isCurrent} = true`),
  ]
);
