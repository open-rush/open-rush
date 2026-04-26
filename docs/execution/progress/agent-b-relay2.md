# Agent-B-relay2 进度

接替 agent-b-relay 完成 M3 尾声的最后一项 — task-14(SSE `/events`)。

## 总览

文件域:
- `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/` (新增 route + test)

Worktree: `/tmp/agent-wt/b2`(branch `feat/task-14`,基于 main `c109b43`)。

## task-14 ✅(Sparring 待跑)

### 交付
- `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts` — SSE endpoint
- `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.test.ts` — 18 单测

### 关键设计决策

1. **Liveness = 轮询 `run_events` 而不是订阅 StreamRegistry**。理由:
   - `run_events` 已经是单写者权威来源(control-worker 通过
     `DrizzleEventStore.appendAssignSeq` 写入),API 读端没必要再引一层 Redis
     pub/sub 作 live channel。
   - 现有 legacy `/api/runs/[id]/stream` 也用同款轮询策略,保持一致。
   - 保留 `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`
     保证 nginx 等代理不缓冲。
   - StreamRegistry 留给后续如需要严格的"秒级 live"时再加一层扇出
     (目前 500ms poll 对 P0 足够,且更简单可测)。

2. **Liveness 收尾**:poll tick 检测到 `run.status` 终结时,再 drain 一次捕获
   "终结前最后写入但本次 tick 未拉到"的事件,然后 close。这避免 race:
   control-worker 写完 `data-openrush-run-done` 后立刻 transition 到 completed,
   如果只按 status 判断直接 close 会漏掉那条事件。

3. **Last-Event-ID 容错**:缺省视为 0(= 从头开始);非数字/负数返回 400
   VALIDATION_ERROR(而非 silent clamp),避免客户端因 proxy bug 吃掉部分 header
   导致悄悄重放整个流。

3a. **错误路径不发合成 frame**(Sparring 第一轮 MUST-FIX):
   - 每条 SSE frame 必须有 `id: <seq>`(spec §事件协议 + §断线重连)
   - 初始 replay / poll tick 抛错时,我们没有 seq 可以附加 → 直接 close stream
   - 客户端看到 EOF,自动用 `Last-Event-ID` 重连;如果底层错误持续,重连也会
     EOF,这是游标型传输的正确失败模式

3b. **不设 lifetime cap**(Sparring 第一轮 MUST-FIX):
   - 曾经加了 `SSE_MAX_LIFETIME_MS = 5 * 60 * 1000`,会在 run 还没 terminal 时
     主动断开,违反"Live run 持续 poll `run_events` 直到 terminal 再关"的验收
   - 移除该 timer — 活跃 run 的连接寿命 = run 本身的寿命,由状态机或 client abort
     决定关闭时机

4. **协议单一**:不支持 query cursor,仅 `Last-Event-ID` header(符合 spec
   §断线重连)。`afterSeq = 0` 意味着 "seq > 0",即 `appendAssignSeq` 从 1 起始的
   所有事件都能命中。

5. **Cross-agent probing 404**:与 task-13 一致,`run.taskId !== URL agentId` 返回
   404,不泄露真实归属。

6. **initial replay 失败 → 直接 close(不发 body frame)**。见 3a:每条 frame 必须
   有 `id: <seq>`,错误分支没有 seq 可附,所以直接 EOF,客户端靠最近的
   `Last-Event-ID` 重连。

6a. **Abort 竞态修复**(Sparring 第三轮 MUST-FIX):
   - `abort` listener 在 route handler 里、`new ReadableStream` 之前就注册
     (靠闭包共享 `closed` + `pollTimer` + `streamController`),避免
     "drain 期间 abort 触发但 listener 未装"导致的"幽灵轮询"
   - 注册前先查 `request.signal.aborted`,预置 `closed = true`,start 里检测到
     就立即 close 不执行任何 DB 调用
   - `{ once: true }` 防止 listener 重复触发
   - `cancel()` 也调用 `cleanup()`,防止 reader 被消费方 cancel 时 setInterval
     成为孤儿继续打 DB

7. **nodejs runtime**:`export const runtime = 'nodejs'` 强制。Edge runtime
   不支持 `pg` + DrizzleEventStore。

### 测试策略

- Mock `DrizzleEventStore`、`RunService`、`isTerminal`,不依赖 Redis/Postgres
- 用 `ReadableStream<Uint8Array>` 的 reader 逐字节读 SSE 帧,按 `\n\n` 切分
- Fake timers 模拟 polling 节拍(`vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync`)
- AbortController 模拟客户端断连

### 覆盖场景

- 401 未鉴权 / 403 缺 scope `runs:read` / 403 无 project 访问
- 400 agentId / runId 非 UUID
- 400 Last-Event-ID 非数字 / 负数
- 404 run 不存在 / 404 cross-agent probing
- 终结 run:replay 后直接 close(completed + failed)
- Last-Event-ID 从指定 seq 起 replay(不重复不丢失)
- Last-Event-ID 超大值 → 空 frame + close
- 活跃 run:initial replay + 两次 poll tick 后终结
- 活跃 run:空 tick 间隔正常透出后续事件
- 客户端 abort:stream 关闭 reader 收到 `done`
- Initial replay 抛错 → stream 直接 close(0 frames,见 3a 决策)
- Query cursor(`?cursor=/?after=/?seq=`)被忽略(header-only 协议回归测试)
- Last-Event-ID 空串 / 全空白 → 400(防止 `z.coerce.number()` 默认 0 的 silent replay)
- abort 在 GET 返回后 start 前触发 → 不进入 polling(6a 竞态回归)
- reader 主动 cancel → poll interval 立即停(cancel() 调用 cleanup 回归)

### 不要踩的坑

- 测试里 `vi.useFakeTimers()` 必须在 test 内调用,且 `afterEach`
  `vi.useRealTimers()` 复位,否则污染后续 suite。
- `await vi.advanceTimersByTimeAsync(0)` 让初始 replay 的微任务有机会 settle。

### 关于前任 waiver(过期信息)

前任 agent-b-relay 的 handoff 最后有一条:"task-9 vault 测试在 origin/main 也失败"。
那条已过时:coordinator 验证 main 上 `pnpm build` + `pnpm test` 全绿(290/290)。
实际原因是前任未执行 `pnpm build` 就 `pnpm test`,导致 dist 过时。本次开工时
coordinator 在 handoff 里明确要求先 `pnpm install && pnpm build`,照做后一切正常。

## 通用门禁结果

- `pnpm build` ✅(workspace packages 全 build,web next build 成功)
- `pnpm check` ✅
- `pnpm lint` ✅
- `pnpm test` ✅(392 passed,含 18 新)
- `./docs/execution/verify.sh task-14` ✅
