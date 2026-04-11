import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.js';
import { users } from './users.js';

export const vaultEntries = pgTable(
  'vault_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: varchar('scope', { length: 20 }).notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 255 }).notNull(),
    credentialType: varchar('credential_type', { length: 50 }).notNull().default('env'),
    encryptedValue: text('encrypted_value').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    injectionTarget: varchar('injection_target', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'vault_scope_project_check',
      sql`(${t.scope} = 'platform' AND ${t.projectId} IS NULL) OR (${t.scope} = 'project' AND ${t.projectId} IS NOT NULL)`
    ),
    unique('vault_entries_scope_project_name_idx').on(t.scope, t.projectId, t.name),
    index('vault_entries_platform_name_idx').on(t.scope, t.name).where(sql`${t.projectId} IS NULL`),
  ]
);
