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

## task-13 ✅(Sparring 待跑)

基于 feat/task-12(含 task-12 PR #150 的未 merged 代码)。

### 交付
- `apps/web/app/api/v1/agents/[agentId]/runs/helpers.ts` — `runToV1`(支持 `statusOverride`)、`mapRunServiceError`(IdempotencyConflict→409、RunCannotCancel→400、RunNotFound→404)、cursor helpers
- `[agentId]/runs/route.ts` — POST(Idempotency-Key 可选;Agent terminal → 409 VERSION_CONFLICT)、GET list
- `[agentId]/runs/[runId]/route.ts` — GET 单 Run(cross-agent probing 一律 404)
- `[agentId]/runs/[runId]/cancel/route.ts` — POST cancel(run.status=failed → 响应 status=cancelled)
- 40 个单测

### 关键设计决策
- **wire 的 `agentId` = 任务 id = tasks.id**(不是 AgentDefinition id)。所有 runToV1 都接 `apiAgentId` 参数,由 route 填入。
- **cancel 响应的 status 覆写**:service 层转 `failed` + errorMessage 表示 cancelled,API 层 `statusOverride='cancelled'` 映射(spec §E2E 3.5)。v0.1 状态机没有 cancelled 终态,这是纯 API 层伪装。
- **已终结 cancel 幂等**:`RunAlreadyTerminalError` → route 重读 run 再以 `statusOverride='cancelled'` 返回 200。
- **Idempotency-Key 处理**:header 存在 → 先 `idempotencyKeyHeaderSchema.safeParse` 校验格式(400 on malformed),再 `computeIdempotencyHash(parsedBody)` 算 hash(canonical JSON,key 顺序不敏感)。未带 header → 退化为 `createRun`(未传 idempotency 参数)。
- **Agent 终态守护**:task.status ∈ {completed, cancelled} → 409 VERSION_CONFLICT(不用 IDEMPOTENCY_CONFLICT 因为跟 key 无关,用 VERSION_CONFLICT 表达"资源状态不允许此操作")。
- **Cross-agent probing 防护**:所有 [runId] 路由先校 `run.taskId === URL agentId`,不等则 404(不泄露 run 存在于别处)。
- **definitionVersion 必须非 null**:legacy row 没 version → 400 + hint 让客户端 recreate(task-11 保证新 row 有)。
- **IdempotencyConflictError → 409 IDEMPOTENCY_CONFLICT**:service 层 throw,route 用 `mapRunServiceError` 捕获并映射。

## task-14(交接给下一任 relay)

Context 已在 task-13 Sparring 5 轮后推到 70% 红线,task-14 SSE + Redis + replay 复杂度留给新 session。

### 文件域
- **新增**: `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts`(+ test)
- **禁改**: 其他

### 依赖与参考
- task-10 merged(`packages/control-plane/src/drizzle-event-store.ts` 有 `appendAssignSeq` + seq 分配)
- task-13 merged(PR #152 等 merge 后 rebase)
- StreamRegistry API: `packages/stream/src/stream-registry.ts`(publish / resume / exists)
- Spec: `specs/managed-agents-api.md §断线重连` + §事件写入单写者模型

### 合约(已就绪,task-4 已定义)
- `v1.lastEventIdHeaderSchema` — `z.coerce.number().int().min(0)`
- `v1.runEventSseFrameSchema` — `{ id: number, data: runEventPayloadSchema }`
- `v1.runEventPayloadSchema` — UIMessageChunk ∪ openrush extensions discriminated union

### 关键设计要点
1. **协议**:Content-Type: text/event-stream + Cache-Control: no-cache;每条事件三行:`id: <seq>\ndata: <json>\n\n`
2. **Last-Event-ID header**:仅支持 header,不支持 query cursor(spec §断线重连 明确单一协议)
3. **流程**:
   ```
   auth + scope + 404/403 检查(参考 task-13 [runId]/route.ts)
   parse Last-Event-ID 为 N(缺省 0)
   如果 run 已终结(completed/failed/finalized) → replay from seq>N 完后 close
   否则(活跃 run) → replay from seq>N,然后订阅 StreamRegistry live
   ```
4. **replay SQL**: 用 `DrizzleEventStore.readByRun(runId, { afterSeq: N })` 或类似 reader(task-10 应该有)。事件本身是 `run_events` 表,按 seq 顺序读
5. **StreamRegistry**:`registry.resume(streamId, fromId?)` 能直接给你 replay + live 合一的流;看 task-10 代码怎么用的
6. **关键不变式**:
   - `id: <seq>` 必须出现在每条(客户端 EventSource 自动记忆)
   - 结束 run 发完 replay 就关连接(不能挂住)
   - 活跃 run 的 live 事件也带 `id`
7. **Scope**: `runs:read`
8. **Cross-agent probing**:同 task-13,run.taskId !== URL agentId → 404

### 实现骨架参考
```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  // 1. auth + scope + 参数校验 + run + task + project 校验(复用 task-13 runs/[runId]/route.ts 前半段)
  // 2. parse Last-Event-ID:
  const headerRaw = request.headers.get('last-event-id') ?? request.headers.get('Last-Event-ID');
  const lastEventId = headerRaw ? v1.lastEventIdHeaderSchema.safeParse(headerRaw) : { success: true, data: 0 };
  if (!lastEventId.success) return v1ValidationError(lastEventId.error);
  const fromSeq = lastEventId.data;

  // 3. 构造 ReadableStream(web streams)
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // replay
      const events = await eventStore.readByRun(runId, { afterSeq: fromSeq });
      for (const ev of events) {
        controller.enqueue(enc.encode(`id: ${ev.seq}\ndata: ${JSON.stringify(ev.payload)}\n\n`));
      }
      // 活跃 run → subscribe live
      if (run.status in [terminal set]) {
        controller.close();
      } else {
        const unsub = streamRegistry.subscribe(runId, (ev) => {
          controller.enqueue(enc.encode(`id: ${ev.seq}\ndata: ${JSON.stringify(ev.payload)}\n\n`));
        });
        request.signal.addEventListener('abort', () => {
          unsub();
          controller.close();
        });
      }
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
}
```

(上面是示意;具体 API 以 StreamRegistry 实际 signature 为准,task-10 已经有消费样例)

### 测试策略
- 单测用 ReadableStream 的 reader 逐条读,断言 `id: N\ndata: {...}` 格式
- mock StreamRegistry 模拟 live 事件推送
- 覆盖:auth/scope/404/403/Last-Event-ID 解析/空 replay/结束 run replay-only close/活跃 run replay+live/abort 断连

### 不要踩的坑
- 别用 Response.json,用手动拼接 SSE 帧
- Last-Event-ID 无效或超大数值要容错(clamp 或 400)
- 订阅 cleanup 必须在 request.signal abort 时执行,否则内存泄漏
- Next.js route handler 对长连接 OK,但要用 `export const runtime = 'nodejs'`(edge runtime 不支持 pg 客户端 + Redis)

### 重要:task-9 vault 失败不是你的锅
rebase 到含 task-9 的 main 后跑 `pnpm test` 会看到 `app/api/v1/vaults/entries/vaults.integration.test.ts` 5 个失败(`resolved.service.findById is not a function`)。**这在干净的 origin/main 上也失败**,是 task-9(PR #149)的遗留 bug,跟 task-14 无关。如果 verify.sh 因此红,跟 team-lead 确认一下是否 waive,或等 Agent-A-relay 先修。

## 给后续 relay 的坑

- `apps/web/.env` 必须存在(`cp .env.example .env` 就行)才能 `pnpm build`(Next.js page data collection 需要 DATABASE_URL 解析)。
- Biome 禁 `.then` 属性 → 测试里的 drizzle fake 不能挂 thenable;用 `Object.assign(asPromise, chain)` 方案替代。
- `listAgentsQuerySchema.status` 走的是 API-layer `AgentStatus` 枚举(`active`/`completed`/`cancelled`),**不是** DB `tasks.status`;好在 DB 目前也只用这三个值,直接等值比较 OK。
