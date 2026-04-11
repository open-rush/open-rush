import { pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';
import { users } from './users.js';

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('project_members_project_user_idx').on(t.projectId, t.userId)]
);
