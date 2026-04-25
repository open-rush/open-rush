# Agent-A (Registry + Auth) Progress

## Overview
负责 task-7 → task-8 → task-9 串行。文件域:
- `packages/control-plane/src/agent-definition-service.ts`
- `apps/web/app/api/v1/{agent-definitions,vaults}/*`
- (auth route 部分,task-5/6 已由 Agent-0-relay 完成)

## task-7: AgentDefinitionService(PATCH 版本化 + 乐观并发)
- **状态**: ✅ 完成,等 Sparring + PR
- **分支**: `feat/task-7`
- **文件域**:
  - `packages/control-plane/src/agent-definition-service.ts`(新,~355 行实现)
  - `packages/control-plane/src/__tests__/agent-definition-service.test.ts`(新,28 tests)
  - `packages/control-plane/src/index.ts`(添加 exports,仅新增自己的符号)
  - `docs/execution/TASKS.md`(勾选 checkbox)
- **关键决策**:
  - **Ports/Adapters**: 跟随 `ProjectAgentService` 模式,直接消费 `DbClient`(drizzle-orm 事务),不抽象 DB port。测试用 pglite(同 repo 其他测试约定)。
  - **事务 & 悲观锁**: PATCH 和 archive 都在 `db.transaction` 内用 `.for('update')` 行锁,保证同 agent 的并发 PATCH 严格串行(spec §PATCH 流程 6 步原子)。
  - **乐观并发**: `If-Match` 在行锁后与 `agents.current_version` 比较,不匹配 → `AgentDefinitionVersionConflictError`(API 层映射 409 VERSION_CONFLICT)。
  - **Snapshot 格式**: 只存 editable 字段(13 个),排除 id / projectId / currentVersion / archivedAt / createdAt / updatedAt / lastActiveAt / activeStreamId / createdBy / isBuiltin / customTitle / status。测试 assertion 明确排除这些字段。与 `agentDefinitionEditableSchema`(contracts v1)对齐。
  - **domain vs contract 类型**: 内部 `AgentDefinition` 保留 `Date` 对象,由 API 路由(task-8)转 ISO。避免在 service 层做 ISO 字符串转换(复用不方便)。
  - **空 patch 快速拒绝**: `pickEditablePatch()` 过滤出真正要改的 editable 字段,空集直接抛 `EmptyAgentDefinitionPatchError`(400),不进事务 — 和 Zod `patchAgentDefinitionRequestSchema` 的 refine 语义完全对齐。
  - **archive 幂等**: 已 archive 的再 archive 不 bump version、不更新 archived_at(测试覆盖)。归档是 metadata,不改 definition。
  - **getByVersion 的 updatedAt**: 用 version 行的 `createdAt`(= 该版本写入时间),不是 agents 表的 updatedAt。这样客户端 sort history 的时间戳是"这个版本生成的时刻",语义一致。
  - **listVersions cursor**: 用 `version` 数字本身作 opaque cursor,`lt(version, cursor)` 查下一页;`limit + 1` fetch 检测 hasMore。
  - **NotFound 错误链**: `getByVersion` 先校验 agent 存在(`AgentDefinitionNotFoundError`),再校验 version(`AgentDefinitionVersionNotFoundError`)。
  - **错误类设计**: 5 个专属错误类(NotFound / VersionNotFound / VersionConflict / Archived / EmptyPatch),API 层可按 `instanceof` 映射到 v1 ErrorCode + HTTP 状态。
- **测试覆盖**(28 tests,分 6 section):
  - create:v1 snapshot 一致性 / changeNote 默认 null / config 存 jsonb 往返
  - get:正常 / NotFound / 归档后仍可 get
  - getByVersion:snapshot 合并 / VersionNotFound / AgentNotFound 优先 / 非正整数拒绝
  - listVersions:desc 排序无 snapshot / cursor 分页 3 页正确 / NotFound / limit clamp
  - patch:原子 bump / 409 conflict / 并发 Promise.allSettled 只一个赢 / archive 后 patch 被拒 / 空 patch 拒绝 / 未覆盖字段保留 / 显式 null 允许
  - archive:设置 archived_at / 幂等(二次 archive)/ NotFound / FK cascade sanity
  - 不变量:两 agent 共用 version=1 / 单调 version per agent
- **坑 / 经验**:
  - **context 被 hijack 一次**: 中途有外部进程把我切到 `feat/task-5` 并且 pull origin main 合掉我的 branch。靠 `git fsck --lost-found` 在 dangling tree 里找回了 blob `16b01e92...`(service)+ `110291272...`(test),cat-file 存到 /tmp 后再 restore。教训:untracked 文件随时可能消失,尽早 commit。
  - **biome 格式差异**: 写代码时没跑 format,第一次 verify.sh 被 lint 卡。`pnpm exec biome check --write` 修掉 import 排序 + line 折行。现在两文件都 clean。
  - **FOR UPDATE 在 pglite**: `.for('update')` 在 pglite 单进程里是 no-op 但 syntax 合法,生产 PG 才真有行锁。测试里靠 Promise.allSettled 同步触发并发 — 由于 pglite 是单线程,两个 patch 会串行,但 version 检查仍保证只有一个成功。结论:测试逻辑覆盖 409,production lock 靠 PG。
  - **drizzle update 的 undefined 清洗**: `.set({})` 里 undefined 字段 drizzle 会跳过,但安全起见在 patch 里手动 `delete updateValues[k]` 清掉 undefined 防止覆盖为 NULL。
  - `Repo 隐性约定` 同 agent-0 笔记 §2/5:控制面 test 文件要 inline DDL 三处同步(但我只新加测试,不改 schema,所以只动自己这一个文件的 DDL block,保持和 pglite-helpers.ts 一致)。
- **Sparring 轮 1**(Codex gpt-5.3-codex-xhigh):
  - **MUST-FIX**: snapshot 字段 camelCase 与 0009 migration 回填的 snake_case 不一致,`getByVersion` 读旧 v1 会漏字段。
    → 修:加 `readSnapshotField()` 容错读(两种 key 都试),同时加测试 `reads legacy snake_case v1 snapshot`。
  - **SHOULD-FIX**: `getByVersion(0)` 抛 NotFound 不符合 VALIDATION 语义;同理 `patch(ifMatchVersion=-1)` 抛 Conflict 混淆。
    → 修:新增 `InvalidAgentDefinitionInputError` 错误类,`getByVersion` + `patch` 前置校验用它,映射 VALIDATION_ERROR。
  - **SHOULD-FIX**: PGlite 单线程不能证明 PG `FOR UPDATE` 行锁语义。
    → 修:在并发 test 加 NOTE 注明这是 service 层 optimistic check 证据,真实 PG 锁留给 task-8 API 集成测试。
- **Sparring 轮 2**: **APPROVE**(逐项确认 snake_case 兼容 / 错误分类可区分 / 并发证据 / 无回归)
- **验证结果**(修复后):
  - `pnpm --filter @open-rush/control-plane build` PASS(tsup + DTS)
  - `pnpm --filter @open-rush/control-plane check` PASS
  - `pnpm --filter @open-rush/control-plane lint` 无 error(3 warnings 都是 pre-existing)
  - `pnpm --filter @open-rush/control-plane test` 35 files / 476 tests(含我的 1 file / 30 tests)全绿
  - `./docs/execution/verify.sh task-7` PASS

## task-8: API /api/v1/agent-definitions/*(待 task-7 merge 后)
- 依赖 task-5(已 merged,可直接 `authenticate()` / `hasScope()`)+ task-7(本分支)
- 计划消费 contracts v1 的 6 个 schema,由 route handler 层把 `Date` → ISO + 错误类 → 401/403/404/409/400

## task-9: API /api/v1/vaults/entries/*(待 task-5 & task-4 — 都已 ready)
- 等 task-7/8 合并后启动

## 纪律 / 流程

- 每 task 单独 branch、单独 PR、Sparring APPROVE 才 commit
- context > 50% 通知 team-lead,> 70% 必换
- 受保护文件不改;只勾 TASKS.md checkbox
