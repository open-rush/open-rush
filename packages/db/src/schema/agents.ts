import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
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
    name: varchar('name', { length: 120 }).notNull().default('New Agent'),
    description: text('description'),
    icon: varchar('icon', { length: 50 }),
    providerType: varchar('provider_type', { length: 50 }).notNull().default('claude-code'),
    model: varchar('model', { length: 255 }),
    systemPrompt: text('system_prompt'),
    allowedTools: jsonb('allowed_tools').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    skills: jsonb('skills').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    mcpServers: jsonb('mcp_servers').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    maxSteps: integer('max_steps').notNull().default(30),
    deliveryMode: varchar('delivery_mode', { length: 20 }).notNull().default('chat'),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    customTitle: varchar('custom_title', { length: 200 }),
    config: jsonb('config'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    activeStreamId: text('active_stream_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('agents_project_id_idx').on(t.projectId),
    index('agents_status_idx').on(t.status),
    index('agents_project_status_idx').on(t.projectId, t.status),
  ]
);
