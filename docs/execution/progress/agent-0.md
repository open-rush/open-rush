# Agent-0 Foundation 进度

## 总览
负责 M1 六个任务(schema + contracts + auth middleware)。严格串行执行。

## task-1 Schema agent_definition_versions + agents 字段
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-1`
- **文件域**: `packages/db/src/schema/agents.ts`, `packages/db/src/schema/agent-definition-versions.ts`, `packages/db/drizzle/0009_agent_definition_versions.sql`, 相关测试 + pglite helper 更新
- **关键决策**:
  - 新增 `agent_definition_versions` 表,FK `agent_id → agents.id ON DELETE CASCADE`,`created_by → users.id ON DELETE SET NULL`。
  - `agents` 表扩两列:`current_version integer NOT NULL DEFAULT 1`、`archived_at timestamptz`。
  - Migration 中使用 `to_jsonb(agents.*) - 'id' - 'created_at' - ...` 剥掉 metadata/runtime 字段,符合 spec §初次 migration。
  - 采用手写 migration SQL 而非 drizzle-kit 生成,因现有 journal 在 0007/0008 已存在 snapshot 漂移(0007 无 snapshot,0008 snapshot 未反映其变更);drizzle-kit 生成的会尝试重建已有的 tasks/mcp_* 等表。
  - 同步更新 `packages/db/test/pglite-helpers.ts` + `packages/control-plane/src/__tests__/*` 三处 agents 表 DDL(加两列),保证所有依赖 PGlite 的测试不挂。
  - 测试覆盖:unique 约束、同 agent 单调递增、不同 agent 可共用版本号、FK cascade、FK set null、default 行为、migration 回填 v1 snapshot。
- **已知问题**:`docs/execution/verify.sh` 使用了错误的 scope 名 `@openrush/db`(实际是 `@open-rush/db`),task-specific filter 是 no-op。由于 verify.sh 是受保护文件,不修改;通用 `pnpm test` 已覆盖本任务全部测试。
- **验证结果**: `pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-1` PASS(69 个 db 测试通过)。

## task-2 Schema service_tokens
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-2`
- **文件域**: `packages/db/src/schema/service-tokens.ts`(新)、`packages/db/drizzle/0010_service_tokens.sql`(新)、`packages/db/test/pglite-helpers.ts`(加 DDL + TABLE_NAMES)、`packages/db/src/__tests__/{service-tokens,schema,migration}.test.ts`。
- **关键决策**:
  - token_hash `text NOT NULL` + 全局 UNIQUE(hash 冲突在任何 user 之间都是 bug)。
  - `service_tokens_active_idx` partial index on `token_hash WHERE revoked_at IS NULL`,对齐 spec 和 authenticate() 的快速路径。
  - owner_user_id FK CASCADE on DELETE。
  - scopes jsonb 默认 `'[]'::jsonb`。
  - 测试覆盖:defaults、scopes ordering、hash 存储形式(64 hex、不含明文)、UNIQUE 冲突、NOT NULL(用 raw SQL 绕过 TS)、FK 违反、CASCADE、active predicate(正常/revocation/expiry/混合)、partial index 存在性 + predicate 文本。
  - migration.test 验证 `service_tokens_active_idx` 的 `WHERE revoked_at IS NULL` predicate 实际在 pg_indexes 中生效。
- **drizzle journal 纠偏**:task-1 遗留了 phantom `0010_chemical_namorita` 条目(源自我本地 regenerate 时没清理干净),本次生成 `0011` 文件。已手动:
  - 把 `0011_neat_loa.sql` 重命名为 `0010_service_tokens.sql`
  - 把 `0011_snapshot.json` 重命名为 `0010_snapshot.json`
  - 删除 journal 中 phantom `0010_chemical_namorita` 条目
  - 0010 snapshot 的 prevId 正好等于 0009 snapshot 的 id,链完整
  - `drizzle-kit generate` 确认无 drift("nothing to migrate")
- **验证结果**: `pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-2` PASS(87 个 db 测试通过,service-tokens filter 真正生效)。
