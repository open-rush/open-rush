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

## task-3 Schema runs extension + tasks.definition_version
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-3`
- **文件域**: `packages/db/src/schema/runs.ts`、`packages/db/src/schema/tasks.ts`、`packages/db/drizzle/0011_runs_versioning_idempotency.sql`(新,drizzle-kit 生成后手工加回填 SQL)、`packages/db/test/pglite-helpers.ts`、`packages/control-plane/src/__tests__/drizzle-{event-store,run-db}.test.ts`、`packages/db/src/__tests__/runs-extension.test.ts`(新)
- **字段**:
  - tasks.definition_version `integer`(nullable,应用层强校验,不落 DB 组合 FK)
  - runs.agent_definition_version `integer`(nullable 以兼容回填,新 run 由 RunService 在 task-11 填)
  - runs.idempotency_key `varchar(255)`
  - runs.idempotency_request_hash `varchar(64)`
- **索引**:
  - `runs_idempotency_lookup_idx` partial index on `runs(idempotency_key, created_at DESC) WHERE idempotency_key IS NOT NULL`
  - 明确不做 UNIQUE,避免"永久冲突"语义(24h 窗口由应用层保证)
- **回填 SQL**(三段):
  1. `UPDATE tasks SET definition_version = 1 WHERE agent_id IS NOT NULL AND definition_version IS NULL`
  2. `UPDATE runs SET agent_definition_version = t.definition_version FROM tasks t WHERE runs.task_id = t.id AND runs.agent_definition_version IS NULL`
  3. `UPDATE runs SET agent_definition_version = a.current_version FROM agents a WHERE runs.agent_id = a.id AND runs.agent_definition_version IS NULL`(兜底)
- **测试覆盖**:字段默认/nullable、idempotency_key 非 UNIQUE(允许重复 insert)、latest-first 查询、24h 窗口断言、partial index predicate 文本、三段回填 SQL 正确性(含 no agent_id / no task_id 兜底),以及(task_id, definition_version)一致性由应用层保证、DB 不做约束。
- **同步更新 control-plane pglite 测试 helper**:加 3 个新字段到 runs DDL,否则 DrizzleRunDb 插入会失败。
- **验证结果**:`pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-3` PASS(101 个 db 测试,runs filter 生效)。

## task-4 Contracts /api/v1/* Zod types(关键里程碑)
- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-4`
- **文件域**: `packages/contracts/src/v1/*`(新子目录 8 文件 + 7 测试文件 + index barrel)、`packages/contracts/src/index.ts` re-export。
- **组织策略**:按 endpoint 功能分 7 个文件 + 1 个 common:`common / auth / agent-definitions / agents / runs / vaults / registry / projects`。index.ts re-export + 根 index 用 `export * as v1 from './v1/index.js'` 命名空间化,避免和内部 schema 同名冲突(如 Run、Project 在内外层都存在)。
- **关键决策**:
  - **AI SDK UIMessagePart 不 import `ai` 包**:spec 写的是 `@ai-sdk/ui-utils`,实际在本仓库这个 tag 下是 `ai` 包。直接加 `ai` 依赖会把 React 等重依赖拖进 contracts(contracts 是 sdk / agent-worker / control-plane 的共同依赖)。改用结构兼容的 Zod schema 定义(`text / reasoning / step-start / tool-* / source-url / file / data-*`),运行时由 Zod 做 shape 验证,编译时消费方按需 `import type { UIMessagePart } from 'ai'`。此决策在 runs.ts 文件里写了长注释说明原因。
  - **Open-rush 扩展事件 discriminated union**:4 个字面量 type(`data-openrush-run-started/run-done/usage/sub-run`),精确 payload。`runEventPayloadSchema` 里 generic `data-*` 用 refine 拒绝 `data-openrush-*` 前缀,防止扩展事件 shape 被泛型 generic 吞掉(测试里专门断言)。
  - **pagination 用 `coerce.number` + 默认 50**;cursor opaque 字符串;response 带 `nextCursor: string | null`(spec 明确是 nullable)。
  - **ServiceTokenScope 枚举不含 `'*'`**:强制在 schema 层面拒绝 Service Token 声明 `*`,避免后续 API handler 需要额外过滤。额外导出 `AuthScope = ServiceTokenScope | '*'` 用于中间件 AuthContext。
  - **错误 code 枚举严格 8 个**,并导出 `ERROR_CODE_HTTP_STATUS` 常量映射给 route handler 用。
  - **PATCH body refine**:要求至少一个可编辑字段(`changeNote` 单独不算),避免 no-op PATCH 产生版本号递增。
  - **If-Match header** 用独立 `ifMatchHeaderSchema`(coerce → positive int)。**Idempotency-Key header** 用独立 `idempotencyKeyHeaderSchema`(≤255 URL-safe),对齐 0011 migration 的 `varchar(255)` 列宽。
  - **deleteAgentResponseSchema 的 status 用 `z.literal('cancelled')`**,契约上锁死 DELETE 只能返回 cancelled 状态。
  - **createVaultEntryRequestSchema** 用 refine 约束 `(scope, projectId)` 组合合法性,在 schema 层面就拒绝非法组合。
- **测试覆盖**:8 个测试文件共 355 tests,每个 schema 都有 happy + 错误路径。重点覆盖:scope `*` 拒绝、幂等 key 格式、SSE 事件 data-openrush-* 前缀保护、vault `(scope, projectId)` refine、PATCH no-op 拒绝、SSE id ≥ 1、分页 nextCursor 必传。
- **不包含**:OpenAPI 生成(按 team-lead 指示跳过,留 task-15);实际 hash 计算 / 中间件逻辑(task-5/11)。
- **验证结果**:`pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-4` PASS(355 contracts tests + 全量 test 正常)。

## M1 Milestone
所有 task-1/2/3/4 完成后,M1(Foundation)结束。Agent-A (M2) 和 Agent-B (M3) 可并行启动。
