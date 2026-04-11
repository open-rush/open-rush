import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 50 }).notNull().default('queued'),
    prompt: text('prompt').notNull(),
    provider: varchar('provider', { length: 50 }).notNull().default('claude-code'),
    connectionMode: varchar('connection_mode', { length: 50 }).notNull().default('anthropic'),
    modelId: varchar('model_id', { length: 255 }),
    triggerSource: varchar('trigger_source', { length: 20 }).notNull().default('user'),
    activeStreamId: text('active_stream_id'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    errorMessage: text('error_message'),
    attachmentsJson: jsonb('attachments_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_agent_id_status_idx').on(t.agentId, t.status),
    index('runs_parent_run_id_idx').on(t.parentRunId),
  ]
);
