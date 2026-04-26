# task-18 E2E 专项 handoff — SSE `/events` 协议 & 测试地形

来自 agent-b-relay2(task-14 交付者)。task-18 要写
`apps/web/e2e/v1-api.spec.ts` 覆盖 `specs/managed-agents-api.md §E2E 测试`
的 6 场景,其中 **场景 3 "Agent + Run + Event 闭环"** 需要测
"断线 → 带 Last-Event-ID 重连 → 无重复无丢"。本文档是给 task-18
agent 的 SSE 专项提示,避免重踩 task-14 Sparring 4 轮的坑。

## 1. SSE 协议铁律(task-14 锁定)

这些是 `/api/v1/agents/:agentId/runs/:runId/events` 的协议不变式,E2E
断言必须贴着它们写。实现在 `apps/web/app/api/v1/agents/[agentId]/runs/
[runId]/events/route.ts`。

### 1.1 每条 frame 必带 `id: <seq>`
格式:`id: <seq>\ndata: <json>\n\n`。EventSource 自动把最新 `id` 记住,
断线重连时浏览器会把它塞进 `Last-Event-ID` header。**没有 `id` 的
frame 会导致客户端丢失游标**。实现里**不存在 bare `data:` frame**
(包括错误路径);错误就 close 连接,靠客户端重连。

### 1.2 Last-Event-ID 仅支持 header,query 参数被忽略
- `Last-Event-ID: N`(integer ≥ 0)→ 服务端 replay `seq > N`
- `?cursor=X` / `?after=X` / `?seq=X` **完全无效**(spec §断线重连 明确
  "单一协议,不引 query cursor")。task-14 有一条回归测试锁死这点

### 1.3 Last-Event-ID 边界值
- missing → `afterSeq = 0` → replay 全部(`seq > 0`;
  `appendAssignSeq` 从 1 起始,所以 seq=1 也会命中)
- 非数字 / 负数 / **空串 / 全空白** → 400 VALIDATION_ERROR
  - 注意:`z.coerce.number()` 会把 `''` / `'   '` 默默 coerce 成 0,
    route 层特判拒绝。不要以为 empty header 等同于 missing

### 1.4 Terminal run → 全量 replay 后关连接
- `isTerminal(run.status)` 命中(completed / failed)→ 单次 drain,
  然后 `controller.close()`。不装 poll interval,不挂 live subscriber
- 客户端重连同样路径,再 replay 一次,依然关连接(幂等)

### 1.5 活跃 run → 500ms 轮询 run_events,终结后再 drain 一次
- `setInterval(tick, 500)`,tick 里先 `drain()`、再
  `runService.getById` 检查终态
- **关键 race 保护**:检测到终态后再 `drain()` 一次,捕获"tick
  开始到 status transition 之间写入的事件"(典型:控制面写完
  `data-openrush-run-done` 后立刻把状态改 completed)
- 然后才 `cleanup()` 关连接
- **无 fixed lifetime cap**。连接寿命 = run 的寿命 + 客户端连接寿命。
  Sparring 轮 1 曾 catch 5 分钟 cap 违反"live 到 terminal 才关"验收

### 1.6 Abort / cancel 的单一 cleanup 口
- `cleanup()` = 清 interval + `controller.close()`,幂等
- 三个触发源共享一个 `cleanup()`:
  1. `request.signal.abort` listener(在 `new ReadableStream` 外注册,
     `{ once: true }`;handler 开头先 check `signal.aborted` 预置
     `closed = true`)
  2. ReadableStream 的 `cancel()` hook(reader 被消费方取消时)
  3. `tick()` 里检测到终态 / 异常

## 2. SSE 测试地形(vitest unit vs playwright E2E)

task-14 的单测在 `events/route.test.ts`,23 条覆盖了上面全部分支。
E2E 不能复用这些 mock,但测试思路和断言可以搬。

### 2.1 读 SSE body 的三步
```typescript
const res = await fetch('/api/v1/agents/A/runs/R/events', {
  headers: { 'Last-Event-ID': '2' },
});
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
const frames: string[] = [];
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx = buffer.indexOf('\n\n');
  while (idx !== -1) {
    frames.push(buffer.slice(0, idx));
    buffer = buffer.slice(idx + 2);
    idx = buffer.indexOf('\n\n');
  }
}
// 每条 frame 断言:
//   frame.startsWith('id: <n>\n')  ← 解 id
//   frame.split('\n')[1].startsWith('data: ')  ← 解 payload
```

### 2.2 测"断线重连无重复无丢"(场景 3.3-3.5)
1. 发 POST `/agents` 创建 agent + 第一个 run(拿到 runId)
2. 开 SSE 连接不带 `Last-Event-ID`,读若干 frame,记录最新 `id: N`
3. **主动 abort**(e.g. `reader.cancel()` 或 `fetch(…, { signal })`)
4. 再开 SSE 连接,带 `Last-Event-ID: N`
5. 断言:第二次连接**只收到 seq > N** 的 frames(用 id 提取列)
6. 断言:没有 seq ≤ N 的重复 frame
7. 断言:最终 `data-openrush-run-done` 出现,然后连接 close
   (`reader.read()` 返回 `{ done: true }`)

**坑**:活跃 run 期间 abort + 立刻重连,轮询节拍可能让你收到 0 条
frame(run 还没写新事件)。不要 assert 必须有 frame;要 assert
"收到的 frame 的 seq 都 > N"。

### 2.3 测 terminal run 重连幂等
run 已完成,发 SSE 带 `Last-Event-ID: <last seq of run>`。期望:
0 frames,连接立即 close。用这个断言验证"没有因为 seq > N 为空
而挂住"。

### 2.4 Abort signal 断言(不依赖真实客户端)
`AbortController` + `fetch({ signal })`:
```typescript
const ctrl = new AbortController();
const fetchPromise = fetch(url, { signal: ctrl.signal });
// 等 response 进来
const res = await fetchPromise;
// 开始读
const reader = res.body!.getReader();
// ... 读若干 chunk
ctrl.abort();
// await reader.read() 会 reject(AbortError)或返回 done
```
E2E 不需要断言服务端 cleanup 细节(单测已覆盖),断言"再次重连没
错乱"即可。

## 3. 参考文件清单

- **实现**
  - `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts`
    — 协议全貌,注释密度高,读完再写 E2E
  - `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.test.ts`
    — 23 条单测,断言模板可以搬进 E2E
- **协议 & 合约**
  - `specs/managed-agents-api.md §事件协议 §断线重连 §E2E 测试`
  - `packages/contracts/src/v1/runs.ts` — `runEventPayloadSchema`
    (UIMessageChunk ∪ openrush extensions),`lastEventIdHeaderSchema`
- **单写者**
  - `packages/control-plane/src/event-store.ts` — `appendAssignSeq` /
    `getEvents(runId, afterSeq)` 契约(seq > afterSeq,ASC)
  - `packages/control-plane/src/run/run-state-machine.ts` —
    `isTerminal` = completed | failed(注意 E2E 里 user-cancelled run
    的 DB 状态是 `failed + errorMessage='cancelled by user'`,wire 层
    看起来是 cancelled,但 isTerminal 仍命中 → SSE 关连接的逻辑不受影响)

## 4. E2E 场景 3 建议分解

对应 `specs/managed-agents-api.md §E2E 测试` 场景 3:

1. **3.1** POST `/agents` → 自动创建 Agent + 第一个 Run + 返回 runId
2. **3.2** GET `/events`(不带 Last-Event-ID)→ 收到 `text-delta` / `tool-*` /
   `data-openrush-run-done`,断言至少包含这三类 type;断言每条 frame 都有
   `id: <n>`,seq 单调递增从 1 开始
3. **3.3** POST `/runs`(追加消息)→ 新 run 创建,runId2 != runId1
4. **3.4** 打开 SSE 连 runId2,读若干 frame(`id: N`),abort,再开 SSE
   带 `Last-Event-ID: N`,断言只收到 seq > N
5. **3.5** POST `/cancel` runId2 → 响应 status=cancelled;之后 GET `/events`
   应 replay + 关连接,最后一条事件带 `data-openrush-run-done
   status=cancelled`

## 5. 非 SSE E2E 场景(6 场景里的其他 5 个)

不是本文重点,但 task-18 agent 应该知道:

- **场景 1** Service Token 鉴权 — 4 个 case(无 / 错 / 对+够 / 对+不够)
- **场景 2** AgentDefinition CRUD + 版本化 — 6 个 case(create v1 /
  PATCH v2 / If-Match 冲突 / GET ?version=1 / GET /versions / POST
  /archive)
- **场景 4** 幂等性 — 3 个 case(POST 带 Idempotency-Key / 相同 key+body
  replay / 相同 key 不同 body 409)
- **场景 5** 未列出(看 spec)
- **场景 6** 未列出(看 spec)

`verify.sh task-18` 跑 `apps/web/e2e/v1-api.spec.ts`,需要 postgres +
redis 容器就绪(见 `AGENTS.md` 的 E2E 前置)。

## 6. 给 task-18 agent 的警告

- **不要引入 query cursor**。哪怕"顺手支持一下"都是违反 spec 的,
  task-14 Sparring 轮 2 因此让我加了回归测试,**不要破坏那条回归**
- **不要用 bare `data:` frame**(没有 id)。这个坑 task-14 Sparring 轮 1
  catch 过,实现和单测都锁死了
- **不要加 fixed timeout**。Sparring 轮 1 删掉了 5 分钟 cap,E2E 里
  也别依赖"N 秒后连接一定 close"这种假设。连接活多久只看 run 活多久
- **reader 循环务必按 `\n\n` 切分**。直接 `JSON.parse(chunk)` 会踩多条
  frame 合并 / 单条 frame 拆两次 read 的坑
