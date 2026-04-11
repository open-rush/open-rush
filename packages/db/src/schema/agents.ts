import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';
import { users } from './users.js';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    customTitle: varchar('custom_title', { length: 200 }),
    config: jsonb('config'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    activeStreamId: text('active_stream_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('agents_project_id_idx').on(t.projectId), index('agents_status_idx').on(t.status)]
);
