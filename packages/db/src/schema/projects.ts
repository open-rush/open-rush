import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    sandboxProvider: varchar('sandbox_provider', { length: 50 }).notNull().default('opensandbox'),
    defaultModel: varchar('default_model', { length: 255 }),
    defaultConnectionMode: varchar('default_connection_mode', { length: 50 }).default('anthropic'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('projects_created_by_idx').on(t.createdBy)]
);
