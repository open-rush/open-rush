import {
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

export const sandboxes = pgTable(
  'sandboxes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('creating'),
    providerType: varchar('provider_type', { length: 50 }).notNull().default('opensandbox'),
    endpoint: text('endpoint'),
    ttlSeconds: integer('ttl_seconds'),
    labels: jsonb('labels'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
  },
  (t) => [index('sandboxes_agent_id_idx').on(t.agentId), index('sandboxes_status_idx').on(t.status)]
);
