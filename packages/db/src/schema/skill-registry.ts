/**
 * Skill Registry — 市场级 Skill 注册表
 *
 * 与 skills 表不同：skills 是项目级安装记录，skill_registry 是全局市场。
 */

import { sql } from 'drizzle-orm';
import {
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
// Skill Registry — 全局 Skill 市场
// ---------------------------------------------------------------------------

export const skillRegistry = pgTable('skill_registry', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** @scope/skill-name format */
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').notNull().default(''),
  /** Source type: registry, github, gitlab, custom */
  sourceType: varchar('source_type', { length: 20 }).notNull().default('registry'),
  sourceUrl: text('source_url'),
  category: varchar('category', { length: 50 }),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  visibility: varchar('visibility', { length: 20 }).notNull().default('public'),
  /** Latest published version string */
  latestVersion: varchar('latest_version', { length: 50 }),
  /** SKILL.md raw markdown content */
  skillMdContent: text('skill_md_content'),
  /** License identifier (e.g., MIT, Apache-2.0) */
  license: varchar('license', { length: 50 }),
  /** Allowed tools (space-separated) */
  allowedTools: text('allowed_tools'),
  /** Star count (denormalized for sorting) */
  starCount: integer('star_count').notNull().default(0),
  /** Install count */
  installCount: integer('install_count').notNull().default(0),
  /** Owner user */
  createdById: uuid('created_by_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Collaborator user IDs */
  members: jsonb('members').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Group ID (nullable) */
  groupId: uuid('group_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Skill Groups — 分组管理
// ---------------------------------------------------------------------------

export const skillGroups = pgTable('skill_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  /** URL-friendly slug (unique path) */
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  description: text('description'),
  visibility: varchar('visibility', { length: 20 }).notNull().default('public'),
  parentId: uuid('parent_id'),
  createdById: uuid('created_by_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Skill Group Members — 角色: owner, maintainer, developer
// ---------------------------------------------------------------------------

export const skillGroupMembers = pgTable(
  'skill_group_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => skillGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('developer'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('skill_group_members_group_user_idx').on(t.groupId, t.userId)]
);

// ---------------------------------------------------------------------------
// Skill Stars — 收藏
// ---------------------------------------------------------------------------

export const skillStars = pgTable(
  'skill_stars',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    skillName: varchar('skill_name', { length: 255 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('skill_stars_skill_user_idx').on(t.skillName, t.userId)]
);
