import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { projects } from './projects.js';
import { runs } from './runs.js';
import { users } from './users.js';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    handoffSummary: text('handoff_summary'),
    headRunId: uuid('head_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    activeRunId: uuid('active_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    /**
     * AgentDefinition version this Agent (task) is bound to.
     *
     * Nullable at the DB level — enforced at the application layer:
     * AgentService.create() in task-7 will verify that
     * `(task.agent_id, definition_version)` exists in
     * `agent_definition_versions`. See
     * specs/agent-definition-versioning.md §tasks 表.
     *
     * NOT a composite FK to avoid cross-table constraint complexity.
     */
    definitionVersion: integer('definition_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('tasks_project_id_idx').on(t.projectId),
    index('tasks_project_updated_at_idx').on(t.projectId, t.updatedAt),
    index('tasks_status_idx').on(t.status),
    index('tasks_head_run_id_idx').on(t.headRunId),
    index('tasks_active_run_id_idx').on(t.activeRunId),
  ]
);
