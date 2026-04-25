import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Service tokens for machine-to-machine `/api/v1/*` authentication.
 *
 * See specs/service-token-auth.md §数据模型.
 *
 * - `token_hash` stores SHA-256 of the plaintext token (plaintext is returned
 *   to the user exactly once on creation, never persisted).
 * - `token_hash` has a global UNIQUE constraint to catch any collision across
 *   all users. The `service_tokens_active_idx` partial index additionally
 *   speeds up lookups of *active* tokens (revoked_at IS NULL).
 * - `owner_user_id` → users(id) with ON DELETE CASCADE — deleting a user
 *   removes all of their tokens.
 * - `scopes` is a jsonb array of scope strings (e.g. `['agents:read', ...]`),
 *   defaults to `[]`. The v0.1 guardrail rejects `'*'` (enforced at API layer).
 * - `expires_at`, `revoked_at`, `last_used_at` are nullable timestamps used by
 *   the authenticate() middleware to gate validity and track usage.
 */
export const serviceTokens = pgTable(
  'service_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopes: jsonb('scopes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Global UNIQUE on token_hash — a hash collision anywhere is a hard bug.
    uniqueIndex('service_tokens_token_hash_uniq').on(t.tokenHash),
    index('service_tokens_owner_idx').on(t.ownerUserId),
    // Partial index to accelerate the active-token hash lookup path in
    // authenticate() middleware.
    index('service_tokens_active_idx').on(t.tokenHash).where(sql`${t.revokedAt} IS NULL`),
  ]
);
