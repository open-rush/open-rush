import { sql } from 'drizzle-orm';
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
import { conversations } from './conversations.js';
import { tasks } from './tasks.js';

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
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
    /**
     * AgentDefinition version snapshot the run is bound to.
     * Derived from `tasks.definition_version` at run creation; nullable to
     * keep existing rows/tests writable during the migration window, but new
     * rows inserted via RunService (task-11) MUST set this.
     * See specs/agent-definition-versioning.md §runs 表.
     */
    agentDefinitionVersion: integer('agent_definition_version'),
    /**
     * Idempotency-Key header value for `POST /api/v1/agents/:id/runs`. NOT
     * globally UNIQUE — 24h window enforcement is an application-layer
     * concern (see specs/managed-agents-api.md §幂等性).
     */
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    /**
     * SHA-256(canonical JSON body) used to detect "same key, different body"
     * → 409 IDEMPOTENCY_CONFLICT. 64 hex chars.
     */
    idempotencyRequestHash: varchar('idempotency_request_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_agent_id_status_idx').on(t.agentId, t.status),
    index('runs_task_id_idx').on(t.taskId),
    index('runs_conversation_id_idx').on(t.conversationId),
    index('runs_parent_run_id_idx').on(t.parentRunId),
    // Lookup index for idempotency 24h window queries.
    // NOT UNIQUE — avoids "permanent conflict" semantics; 24h window is
    // enforced at the application layer (see specs/managed-agents-api.md
    // §幂等性 §实现).
    index('runs_idempotency_lookup_idx')
      .on(t.idempotencyKey, sql`${t.createdAt} DESC`)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ]
);
