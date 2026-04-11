import { integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { runs } from './runs.js';

export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 50 }).notNull(),
  path: text('path').notNull(),
  storagePath: text('storage_path').notNull(),
  contentType: varchar('content_type', { length: 255 }).notNull(),
  size: integer('size').notNull(),
  checksum: varchar('checksum', { length: 128 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
