# Agent-B-relay 进度

接替 agent-b-runtime 完成 M3 尾声的 task-12 → task-13 → task-14。

## 总览

文件域:
- `apps/web/app/api/v1/agents/*`(task-12/13/14 的全部 route)

Worktree: `/tmp/agent-wt/b`(branch `feat/task-12` 起步,task-13/14 各切独立分支)。

## task-12 ✅(Sparring 待跑)

基于 origin/main `f232352`(含 task-8 的 `apps/web/lib/api/v1-responses.ts`)。

### 交付
- `apps/web/app/api/v1/agents/helpers.ts` — `taskRowToV1Agent`、cursor helpers、`mapRunErrorForAgentDelete`(RunService 错误 → v1 Response / 'soft-degrade' 三态)
- `apps/web/app/api/v1/agents/route.ts` — POST + GET
- `apps/web/app/api/v1/agents/[id]/route.ts` — GET + DELETE
- 44 个单测(20 route collection + 24 [id])覆盖 auth/scope/validation/forbidden/archived/version-mismatch/mode-mismatch/project-mismatch/happy path/cancel 路径 / 幂等 DELETE / soft-degrade

### 关键设计决策
- **Agent = `tasks` 行**(API 命名 vs DB 命名,契约注释已标)
- **AgentDefinition 必须跟 Agent 同 projectId**:顺手把"借用他人定义"漏洞封死(scope check 只看 target project,不看 definition source)。
- **Archived 定义允许创建新 Agent**(对齐 `specs/agent-definition-versioning.md §归档` 的"归档后仍可创建 Agent(兼容历史需求),但会有 warning"),route 只打 `console.warn` 不阻塞。PATCH 归档定义仍然被 AgentDefinitionService 挡住。
- **`mode` 必须匹配定义的 `deliveryMode`**:一个 definition 只能是 chat 或 workspace,想换就换定义(400 + hint)。
- **初始 Run 不走 Idempotency-Key**:spec §幂等性 明确只有 `POST /runs` 支持;客户端需要可重放 → 先 POST agent 再 POST run。
- **DELETE 幂等**:已 cancelled 的 agent DELETE 再次 → 200 no-op,`cancelledRunId: null`。
- **Cancel 路径 soft-degrade**:`RunAlreadyTerminalError` / `RunNotFoundError` 不阻塞 agent soft-cancel;`RunCannotCancelError`(finalizing_retryable_failed) → 400 VALIDATION_ERROR + retry hint(不用 409 的原因:v1 ErrorCode enum 把 409 留给 version/idempotency conflict)。
- **pagination cursor 与 task-8 AgentDefinitionService 同形**:`base64url("<createdAtISO>|<id>")`、`date_trunc('milliseconds', ...)` 统一语义。
- **GET list 无 projectId 时 short-circuit**:memberships 空 → 直接 200 空列表(避免 `IN ()` 语法问题)。
- **POST 写入走一个 `db.transaction()`**:`tasks INSERT` + `runService.createRun` + `tasks UPDATE(back-link activeRunId/headRunId)` 在同一 tx 内原子提交。任一步失败则 rollback,不会留半成品。`DrizzleRunDb(tx)` 通过一次 `tx as unknown as DbClient` cast 传入(drizzle 类型不暴露 tx/DbClient 等价性,但运行时兼容)。

### 测试取巧
- `dbFake` 用 "`where()` 返回 Promise+chain" 的 hybrid(`Object.assign(asPromise, chain)`),因为 memberships 的 `db.select().from(x).innerJoin(y,z).where(w)` 链路没 limit 直接 await。Biome 禁 `.then` 属性导致的绕路。
- 每个 test 用 `dbFake.__select.mockReturnValueOnce(rows)` 按调用顺序排队。

## task-13(待做)

- 文件域: `apps/web/app/api/v1/agents/[agentId]/runs/*`
- 核心: POST create(Idempotency-Key + hash,复用 task-11 `createRunWithIdempotency`)、GET list、GET :runId、POST :runId/cancel
- cancel 响应把 `status='failed'` + `errorMessage='cancelled by user'` 映射回 response `status='cancelled'`(spec §E2E 3.5)
- agent 状态 completed/cancelled → POST runs 返回 409

## task-14(待做)

- 文件域: `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts`
- SSE text/event-stream, 仅 Last-Event-ID, 每条事件带 `id: <seq>`
- replay `run_events WHERE seq > N ORDER BY seq`
- 活跃 run → 订阅 StreamRegistry Redis live;已结束 → replay 完后 close

## 给后续 relay 的坑

- `apps/web/.env` 必须存在(`cp .env.example .env` 就行)才能 `pnpm build`(Next.js page data collection 需要 DATABASE_URL 解析)。
- Biome 禁 `.then` 属性 → 测试里的 drizzle fake 不能挂 thenable;用 `Object.assign(asPromise, chain)` 方案替代。
- `listAgentsQuerySchema.status` 走的是 API-layer `AgentStatus` 枚举(`active`/`completed`/`cancelled`),**不是** DB `tasks.status`;好在 DB 目前也只用这三个值,直接等值比较 OK。
