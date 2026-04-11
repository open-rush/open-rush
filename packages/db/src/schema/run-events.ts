import { bigint, jsonb, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { runs } from './runs.js';

export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload'),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    schemaVersion: varchar('schema_version', { length: 10 }).notNull().default('1'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('run_events_run_seq_idx').on(t.runId, t.seq)]
);
