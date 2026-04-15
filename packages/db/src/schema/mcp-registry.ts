/**
 * MCP Registry — 全局 MCP 注册中心
 *
 * 与 mcp_servers 表不同：mcp_servers 是项目级配置，mcp_registry 是全局注册中心。
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// MCP Registry — 全局 MCP 注册中心
// ---------------------------------------------------------------------------

export const mcpRegistry = pgTable('mcp_registry', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Internal unique name */
  name: varchar('name', { length: 255 }).notNull().unique(),
  /** Display name for UI */
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  /** Transport type: stdio, sse, http */
  transportType: varchar('transport_type', { length: 20 }).notNull(),
  /** Server configuration JSON (command, args, url, env, headers) */
  serverConfig: jsonb('server_config')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Detected tools from this server */
  tools: jsonb('tools')
    .$type<Array<{ name: string; description: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  category: varchar('category', { length: 50 }).default('utilities'),
  author: varchar('author', { length: 255 }),
  /** Extra user-provided config fields (e.g., API keys, tokens) */
  extraConfig: jsonb('extra_config').$type<Record<string, string>>(),
  /** Metadata about extra config fields (help URLs, input types) */
  extraConfigMeta:
    jsonb('extra_config_meta').$type<Record<string, { helpUrl?: string; type?: string }>>(),
  /** Documentation URL */
  docUrl: text('doc_url'),
  /** Repository URL */
  repoUrl: text('repo_url'),
  /** README markdown content */
  readme: text('readme'),
  /** Star count (denormalized) */
  starCount: integer('star_count').notNull().default(0),
  /** Built-in MCP (ships with platform) */
  isBuiltin: boolean('is_builtin').notNull().default(false),
  visibility: varchar('visibility', { length: 20 }).notNull().default('public'),
  /** Data source: manual or mcp_supermarket */
  source: varchar('source', { length: 30 }).default('manual'),
  /** Owner user */
  createdById: uuid('created_by_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Collaborator user IDs */
  members: jsonb('members').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// MCP Stars — 收藏
// ---------------------------------------------------------------------------

export const mcpStars = pgTable(
  'mcp_stars',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mcpId: uuid('mcp_id')
      .notNull()
      .references(() => mcpRegistry.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('mcp_stars_mcp_user_idx').on(t.mcpId, t.userId)]
);

// ---------------------------------------------------------------------------
// MCP User Installs — 用户安装的 MCP（关联全局注册中心条目）
// ---------------------------------------------------------------------------

export const mcpUserInstalls = pgTable(
  'mcp_user_installs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mcpId: uuid('mcp_id')
      .notNull()
      .references(() => mcpRegistry.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** User-specific extra config overrides (e.g., their API keys) */
    userConfig: jsonb('user_config').$type<Record<string, string>>(),
    /** Validation status after install */
    validationStatus: jsonb('validation_status').$type<{
      status: 'verified' | 'credential_required' | 'failed' | 'pending';
      errorCode?: string;
      errorMessage?: string;
      lastCheckedAt: string;
    }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('mcp_user_installs_mcp_user_idx').on(t.mcpId, t.userId)]
);
