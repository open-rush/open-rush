import {
  bigint,
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { runs } from './runs.js';

export const runCheckpoints = pgTable('run_checkpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('in_progress'),
  messagesSnapshotRef: text('messages_snapshot_ref'),
  workspaceDeltaRef: text('workspace_delta_ref'),
  lastEventSeq: bigint('last_event_seq', { mode: 'number' }),
  pendingToolCalls: jsonb('pending_tool_calls'),
  degradedRecovery: boolean('degraded_recovery').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
