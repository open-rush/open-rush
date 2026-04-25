# Open-rush Managed Agents — Task List

Source of truth 见 `.claude/plans/managed-agents-p0-p1.md`。本文件仅用于 Agent Team 自主协调。

## 规则

- **认领**: 创建 `docs/execution/current_tasks/<task-id>.lock`,内容 = agent 名字
- **完成**: 删 lock,commit + push,勾选此处 checkbox
- **依赖**: 等依赖任务 checkbox 勾上再认领
- **冲突域**: 严格按文件域作业,不跨域
- **Sparring**: 每个 PR 必须通过 Cursor Agent / Codex APPROVE
- **Progress**: 关键决策 + 失败原因写到 `docs/execution/progress/<agent>.md`

## Agent 分工

- **Agent-0 (Foundation)**: DB schema、contracts、auth middleware、specs
- **Agent-A (Registry + Auth)**: v1 auth/agent-definitions/vaults API + AgentDefinitionService
- **Agent-B (Runtime + Worker)**: agent-worker AI SDK output + v1 agents/runs API + RunService
- **Agent-C (SDK + Docs + Frontend)**: SDK + OpenAPI + docs + E2E + 前端迁移 + 删 legacy

文件域细则见 `.claude/plans/managed-agents-p0-p1.md` §9.1。

---

## M1: Foundation

- [x] `task-1-schema-agent-definition-versions` — **Agent-0**
      域: `packages/db/src/schema/agent-definition-versions.ts`, `packages/db/drizzle/*.sql`, `packages/db/src/schema/agents.ts` (加 current_version + archived_at)
      依赖: 无
      验收:
      - schema 符合 `specs/agent-definition-versioning.md` §数据模型
      - migration 可正反向
      - 现有 agents 被初始化为 v1 snapshot
      - unit test 覆盖 version 唯一约束 + FK cascade
      - verify: `./docs/execution/verify.sh task-1`

- [x] `task-2-schema-service-tokens` — **Agent-0**
      域: `packages/db/src/schema/service-tokens.ts`, `packages/db/drizzle/*.sql`
      依赖: 无
      验收:
      - schema 符合 `specs/service-token-auth.md` §数据模型
      - unique index on token_hash(active)
      - unit test 覆盖 revocation + expiry 查询
      - verify: `./docs/execution/verify.sh task-2`

- [x] `task-3-schema-runs-extension` — **Agent-0**
      域: `packages/db/src/schema/runs.ts`, `packages/db/drizzle/*.sql`, `packages/db/src/schema/tasks.ts` (加 definition_version)
      依赖: 无
      验收:
      - tasks 加 `definition_version integer`(应用层强校验)
      - runs 加 `agent_definition_version integer`, `idempotency_key varchar(255)`, `idempotency_request_hash varchar(64)`
      - **非唯一** partial index: `runs_idempotency_lookup_idx ON runs(idempotency_key, created_at DESC) WHERE idempotency_key IS NOT NULL`
      - 回填:tasks(=1)、runs.agent_definition_version 从 tasks 级联或 agents.current_version 兜底
      - 对齐 specs/managed-agents-api.md §幂等性 + specs/agent-definition-versioning.md §初次 migration
      - verify: `./docs/execution/verify.sh task-3`

- [x] `task-4-contracts-v1` — **Agent-0**
      域: `packages/contracts/src/v1/*.ts`, `packages/contracts/src/index.ts` re-export
      依赖: task-1, task-2, task-3
      验收:
      - Zod schema 覆盖 24 个 endpoint 的 request/response
      - 错误 code 枚举齐全
      - AI SDK UIMessagePart 类型引入(从 `@ai-sdk/ui-utils`)
      - 单测验证每个 schema 的 happy + 错误路径
      - 同步生成 OpenAPI 基础(可后置到 task-15 完善)
      - verify: `./docs/execution/verify.sh task-4`

- [x] `task-5-unified-auth-middleware` — **Agent-0**
      域: `apps/web/lib/auth/unified-auth.ts`, `apps/web/lib/auth/unified-auth.test.ts`
      依赖: task-2
      验收:
      - 实现 `authenticate(req)` 双轨识别
      - 实现 `hasScope(ctx, required)`
      - lastUsedAt 异步更新,不阻塞请求
      - 单测覆盖:session / service-token / 无 auth / revoked / expired
      - 明文 token 不进日志
      - verify: `./docs/execution/verify.sh task-5`

- [ ] `task-6-api-v1-auth-tokens` — **Agent-0**(收尾 M1)
      域: `apps/web/app/api/v1/auth/tokens/*`, service(复用 Agent-0 已有 util)
      依赖: task-5
      验收:
      - POST 创建 → 只返回一次明文
      - GET 列出不含明文
      - DELETE 软删(revoked_at)
      - POST 需要 session(拒绝 service-token 自颁发)
      - 单测 + 集成测试覆盖以上
      - verify: `./docs/execution/verify.sh task-6`

---

## M2: Registry API

- [ ] `task-7-service-agent-definition` — **Agent-A**
      域: `packages/control-plane/src/agent-definition-service.ts` + 测试
      依赖: task-1, task-4
      验收:
      - create / patch(乐观并发)/ getByVersion / listVersions / archive
      - 事务一致性:patch 时 snapshot + current_version 原子更新
      - 单测覆盖版本冲突 / 归档后 patch 被拒
      - verify: `./docs/execution/verify.sh task-7`

- [ ] `task-8-api-v1-agent-definitions` — **Agent-A**
      域: `apps/web/app/api/v1/agent-definitions/*`
      依赖: task-5, task-7
      验收:
      - 6 endpoint 全部实现
      - PATCH 校验 If-Match header
      - GET 支持 ?version=N
      - scope 校验 + project 归属校验
      - 集成测试覆盖乐观并发 409
      - verify: `./docs/execution/verify.sh task-8`

- [ ] `task-9-api-v1-vaults` — **Agent-A**
      域: `apps/web/app/api/v1/vaults/entries/*`
      依赖: task-5, task-4
      验收:
      - 3 endpoint(create / list / delete)
      - GET 不返回 encryptedValue
      - scope `vaults:read` / `vaults:write`
      - 集成测试覆盖 scope 拒绝 + 资源归属拒绝
      - verify: `./docs/execution/verify.sh task-9`

---

## M3: Runtime API

- [ ] `task-10-agent-worker-ui-message-stream` — **Agent-B**
      域: `apps/agent-worker/src/*`,可能需要 `packages/stream/src/*`
      依赖: task-4
      验收:
      - agent-worker 输出 `@ai-sdk/ui-utils` UIMessagePart 格式
      - 每个 part 按 seq 写入 `run_events`
      - Open-rush 扩展事件(data-openrush-*)由 control-worker 在状态机切换时注入
      - 单测覆盖 part 类型完整性 + seq 单调递增
      - verify: `./docs/execution/verify.sh task-10`

- [ ] `task-11-service-run` — **Agent-B**
      域: `packages/control-plane/src/run-service.ts` 改造
      依赖: task-3, task-4
      验收:
      - 创建 run 时 snapshot `agent_definition_version`
      - Idempotency-Key 去重:24h 内同 key + 同 body → 原 run,不同 body → 409
      - parentRunId / cancel 语义与 spec 一致
      - 单测覆盖幂等 + 版本绑定 + 状态迁移
      - verify: `./docs/execution/verify.sh task-11`

- [ ] `task-12-api-v1-agents` — **Agent-B**
      域: `apps/web/app/api/v1/agents/*`
      依赖: task-5, task-7, task-11
      验收:
      - 4 endpoint(POST / GET / GET:id / DELETE)
      - POST 自动创建 Agent + 第一个 Run
      - DELETE → cancel active run + 软删
      - scope 校验
      - verify: `./docs/execution/verify.sh task-12`

- [ ] `task-13-api-v1-agents-runs` — **Agent-B**
      域: `apps/web/app/api/v1/agents/[agentId]/runs/*`(不含 events)
      依赖: task-11, task-12
      验收:
      - **4 endpoint**: POST create, GET list, GET :runId, POST :runId/cancel
      - POST 支持 Idempotency-Key(见 specs/managed-agents-api.md §幂等性)
      - 已完成/已取消 Agent 禁止新 run → 409
      - verify: `./docs/execution/verify.sh task-13`

- [ ] `task-14-api-v1-events-sse` — **Agent-B**
      域: `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/*`
      依赖: task-10, task-13
      验收:
      - SSE Content-Type: text/event-stream
      - **仅支持 `Last-Event-ID` header**(不引入 query cursor,保持单一协议)
      - 活跃 run 接 Redis live(StreamRegistry)
      - 结束 run 全量 replay 后关闭
      - 每条事件必带 `id: <seq>`(供客户端重连)
      - E2E 覆盖:断线 → 带 Last-Event-ID 重连 → 不重复不丢事件
      - verify: `./docs/execution/verify.sh task-14`

---

## M4: SDK + Docs + Frontend

- [ ] `task-15-openapi-spec` — **Agent-C**
      域: `docs/specs/openapi-v0.1.yaml`, `scripts/validate-openapi.ts`, `package.json` script
      依赖: task-4 + 所有 v1 API
      验收:
      - 24 endpoint 完整 schema
      - CI 跑 validate 脚本
      - 可 import Swagger UI / Postman
      - verify: `./docs/execution/verify.sh task-15`

- [ ] `task-16-typescript-sdk` — **Agent-C**
      域: `packages/sdk/*`(新包 `@open-rush/sdk`)
      依赖: task-4, task-15
      验收:
      - 核心类型 + client 类
      - 支持 createAgentDefinition / createAgent / createRun / streamEvents
      - SSE 消费 + Last-Event-ID 重连
      - 单测覆盖调用链
      - README + 示例
      - verify: `./docs/execution/verify.sh task-16`

- [ ] `task-17-readme-and-docs` — **Agent-C**
      域: `README.md`, `docs/quickstart.md`, `docs/api.md`
      依赖: all APIs + task-16
      验收:
      - README v2 对齐 "Open-source managed agents platform for Claude Code"
      - 与 openclaw-managed-agents 差异化表格
      - Quickstart 3 步跑通一次 Agent 调用
      - api.md 链接到 openapi spec
      - verify: `./docs/execution/verify.sh task-17`

- [ ] `task-18-e2e-tests` — **Agent-C**
      域: `apps/web/e2e/v1-api.spec.ts` + 相关 fixture
      依赖: all APIs
      验收:
      - 覆盖 `specs/managed-agents-api.md` §E2E 测试 6 个场景
      - CI 集成(postgres + redis docker-compose)
      - verify: `./docs/execution/verify.sh task-18`

- [ ] `task-19-frontend-migration-and-legacy-cleanup` — **Agent-C**
      域: `apps/web/app/**/*.tsx`,删除 `apps/web/app/api/` 下**非 v1 非 auth 非 health** 的 route
      依赖: task-8, task-9, task-12, task-13, task-14, task-18
      验收:
      - 前端 fetch 调用全部迁到 `/api/v1/*`
      - 删除 legacy routes(list 见 plan §8 task-19)
      - 保留 `/api/auth/[...nextauth]` / `/api/health`
      - 保留 web UI 专属动作(install/star/members/generate-title)→ 保持在 `/api/*` 但仅接受 session
      - `pnpm build && pnpm check && pnpm lint && pnpm test` 全绿
      - 手动回归:登录 → 创建 AgentDefinition → 启动 Agent → 看 SSE → 取消
      - verify: `./docs/execution/verify.sh task-19`
