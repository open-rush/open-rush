# Managed Agents API Specification

Open-rush 对外 `/api/v1/*` 稳定合约,给外部调用方(rush-app / CLI / 第三方 SDK)使用。本 spec 是 API shape 的设计决策来源,不是详细 endpoint 文档(后者由 `docs/specs/openapi-v0.1.yaml` 生成)。

## 设计原则

- **稳定合约**: `/api/v1/*` 一旦发布,非兼容变更走 `/api/v2/*`
- **API-First**: 外部调用方只能通过 `/api/v1/*`,不直连数据库
- **4-primitive 模型**: AgentDefinition / Agent / Run / Event(见 [四层概念栈](#四层概念栈))
- **统一事件格式**: 事件流对齐 AI SDK UIMessage,前端 `useChat` 零改动
- **资源归属**: 所有资源通过 `project_id` 归属,鉴权走 project membership
- **最小暴露**: Registry 只暴露只读 CRUD(`GET skills`, `GET mcps`),install/star/members 等 UI 专属动作不走 `/api/v1/`
- **对外路径不带 `/api/v1/` 以外前缀**: `/api/*`(非 v1) 为 Web UI 私有补充,不对 Service Token 开放

## 四层概念栈

| 层 | API 层名字 | 内部表 | 含义 |
|---|---|---|---|
| 1 | AgentDefinition | `agents` | 蓝图/配置,不可变版本化(每次 PATCH 产生新 version) |
| 2 | Agent | `tasks` | 一次需求/任务,绑定某 AgentDefinition@version |
| 3 | Run | `runs` | Agent 内一次执行,可多次(chat 追加消息触发新 run / 子任务 / 重试) |
| 4 | Event | `run_events` | Run 内流式事件,AI SDK UIMessage 格式 |

**命名冲突提示**: 数据库表 `agents` 的内容 = API 层的 **AgentDefinition**(蓝图),数据库表 `tasks` 的内容 = API 层的 **Agent**(一次需求)。这是历史命名,API 层通过命名空间纠偏。内部代码维持现状,不强制 rename。

## Endpoint 清单(24 个)

### Auth (3)
- `POST /api/v1/auth/tokens` — 颁发 Service Token(需 session 登录)
- `GET /api/v1/auth/tokens` — 列出自己的 token
- `DELETE /api/v1/auth/tokens/:id` — 吊销

### AgentDefinition (6)
- `POST /api/v1/agent-definitions` — 创建 v1
- `GET /api/v1/agent-definitions` — 列表(分页、project 过滤)
- `GET /api/v1/agent-definitions/:id` — 详情,默认最新;`?version=N` 取特定版本
- `PATCH /api/v1/agent-definitions/:id` — 产生新 version,需带 `If-Match: <current_version>`
- `GET /api/v1/agent-definitions/:id/versions` — 版本历史列表
- `POST /api/v1/agent-definitions/:id/archive` — 归档(设 archived_at)

### Agent (4)
- `POST /api/v1/agents` — 创建 Agent,body `{ definitionId, definitionVersion?, mode: "chat"|"task", projectId, initialInput? }`
- `GET /api/v1/agents` — 列表
- `GET /api/v1/agents/:id` — 详情
- `DELETE /api/v1/agents/:id` — 取消整体(status → cancelled,若有 active run 一并 cancel)

### Run (5)
- `POST /api/v1/agents/:id/runs` — 追加消息或首次启动,body `{ input }`,可选 `Idempotency-Key` header
- `GET /api/v1/agents/:id/runs` — 列表
- `GET /api/v1/agents/:id/runs/:runId` — 详情
- `GET /api/v1/agents/:id/runs/:runId/events` — SSE 流,支持 `Last-Event-ID`
- `POST /api/v1/agents/:id/runs/:runId/cancel` — 取消某次 run

### Vault (3)
- `POST /api/v1/vaults/entries` — 创建凭证
- `GET /api/v1/vaults/entries` — 列表(不返回 encryptedValue)
- `DELETE /api/v1/vaults/entries/:id` — 删除

### Registry (2)
- `GET /api/v1/skills` — 列出可用 skill(分页、搜索、scope 过滤)
- `GET /api/v1/mcps` — 列出可用 MCP server

### Projects (3)
- `POST /api/v1/projects` — 创建
- `GET /api/v1/projects` — 列表
- `GET /api/v1/projects/:id` — 详情

## 请求 / 响应格式

### 成功响应
```json
{
  "data": { ... }
}
```

### 错误响应
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Definition has been modified since your last read",
    "hint": "Fetch the latest version and retry"
  }
}
```

### 错误码(跨 endpoint 一致)
- `UNAUTHORIZED` (401) — 无鉴权
- `FORBIDDEN` (403) — 鉴权通过但无权限或 scope 不足
- `NOT_FOUND` (404) — 资源不存在
- `VALIDATION_ERROR` (400) — body / query / header 不合法
- `VERSION_CONFLICT` (409) — 乐观并发失败
- `IDEMPOTENCY_CONFLICT` (409) — Idempotency-Key 冲突(相同 key 不同 body hash)
- `RATE_LIMITED` (429) — 超出配额 *(预留,v0.1 不实施限流;P2 加)*
- `INTERNAL` (500) — 服务端错误

### 分页
- Query: `?limit=50&cursor=<opaque>`
- Response: `{ data: [...], nextCursor: "..." | null }`

### 幂等性(v0.1 仅 `POST /api/v1/agents/:id/runs` 支持)

**范围**: P0 阶段**只对 `POST /runs` 启用**。其他 POST(如 agents、agent-definitions、vaults)不保证幂等,调用方应通过业务层约束(例如避免重复点击)或后续版本扩展。

**语义**:
- Request header: `Idempotency-Key: <uuid-v4>`(可选,不传则无幂等)
- 存储: `runs.idempotency_key`(varchar 255)+ `runs.created_at`
- 24 小时窗口内:
  - **同 key + 同 body hash** → 返回原 run(200/201,同原响应)
  - **同 key + 不同 body hash** → 409 `IDEMPOTENCY_CONFLICT`,hint 指出 key 已占用
  - **不同 key** → 正常创建
- 24 小时外:key 被视为"过期",同样 key 可复用

**实现**:
- 新增 `runs.idempotency_request_hash varchar(64)`(SHA256 of canonical JSON body)
- 查询条件: `WHERE idempotency_key = ? AND created_at >= now() - interval '24 hours'`
- 唯一索引改为 partial + time-aware(Postgres 不支持时间条件唯一索引,因此改为应用层保证 + background cleanup):
  - 移除 `UNIQUE INDEX runs_idempotency_idx`
  - 改为 `CREATE INDEX runs_idempotency_lookup_idx ON runs(idempotency_key, created_at DESC) WHERE idempotency_key IS NOT NULL;`
  - 应用层逻辑:先查最新 24h 内同 key,存在则比对 hash → 原返回或 409,否则正常插入
  - 并发冲突由 SERIALIZABLE 事务或显式行锁 + retry 处理
- 清理: 定期任务(pg-boss 每日)把 `idempotency_key` 设 NULL(24h+ 之前的行);或不清理,仅查询加时间窗约束(推荐后者,简单)

**Run 表字段最终约定**(task-3):
```sql
ALTER TABLE runs
  ADD COLUMN agent_definition_version integer,
  ADD COLUMN idempotency_key varchar(255),
  ADD COLUMN idempotency_request_hash varchar(64);

CREATE INDEX runs_idempotency_lookup_idx
  ON runs(idempotency_key, created_at DESC)
  WHERE idempotency_key IS NOT NULL;
```

不做 UNIQUE 索引,避免"永久冲突"语义。

## 事件协议(SSE)

### 协议格式

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

id: 42
data: {"type":"text-delta","textDelta":"好的"}

id: 43
data: {"type":"tool-Read","toolCallId":"call_1","state":"call","input":{...}}

id: 44
data: {"type":"data-openrush-run-done","data":{"status":"success"}}
```

### 事件 payload 类型

**AI SDK 标准 part**(直接使用 `@ai-sdk/ui-utils` UIMessagePart):
- `text-delta` — 文本增量
- `reasoning` — 推理
- `step-start` / `step-finish` — 步骤边界
- `tool-<Name>` — 工具调用(state: "call" | "result" | "error")
- `data-<key>` — 自定义数据载荷

**Open-rush 扩展**(统一走 `data-openrush-*` 前缀,前端可选消费):
- `data-openrush-run-started` — `{ runId, agentId, definitionVersion }`
- `data-openrush-run-done` — `{ status: "success"|"failed"|"cancelled", error? }`
- `data-openrush-usage` — `{ tokensIn, tokensOut, costUsd }`
- `data-openrush-sub-run` — `{ parentRunId, childRunId }`

**存储**: `run_events.payload` 直接存 UIMessagePart 原格式,`run_events.event_type` 存 `type` 字段便于查询。

### 事件写入单写者模型

**`run_events` 只由 control-worker 写**(见 plan §7.3)。agent-worker 通过 SSE① 推给 control-worker,由后者统一分配 `seq`。

`seq` 分配方式(同一 run 内串行):
```sql
INSERT INTO run_events (run_id, seq, event_type, payload, ...)
SELECT $1,
       COALESCE((SELECT MAX(seq) FROM run_events WHERE run_id = $1), 0) + 1,
       $2, $3, ...
RETURNING seq;
```
在 SERIALIZABLE 隔离或 `pg_advisory_xact_lock(hashtext(run_id::text))` 保护下执行。

control-worker 注入的 `data-openrush-*` 扩展事件走同一 EventStore,共享 seq 分配。agent-worker **不直接写 DB**。

### 断线重连(仅 `Last-Event-ID`,无 query cursor)

保持单一协议:
- 客户端带 `Last-Event-ID: N` header
- 每条 SSE 消息必带 `id: <seq>` 字段,客户端自动记忆最新 id,断线重连时浏览器会自动 set `Last-Event-ID`
- 服务端先 replay `SELECT * FROM run_events WHERE run_id = ? AND seq > N ORDER BY seq`
- 然后接入 live stream(StreamRegistry Redis pub/sub)
- 对已结束 run(status=success/failed/cancelled),全量 replay 后关连接
- 不使用 query cursor(避免协议双轨)

## 鉴权

详见 `specs/service-token-auth.md`。本 spec 只说明 API 层如何消费:

- 每个 `/api/v1/*` route handler 首行调用 `authenticate(req)` → 返回 `AuthContext | null`
- `AuthContext` 包含 `userId`、`scopes`、`authType`("session" | "service-token")
- `null` → 401
- 检查资源归属(`project.memberships` / `vault.ownerId`)→ 403
- 检查 scope 包含所需权限 → 403
- 操作执行,返回 200

### Scope 矩阵

**权威来源**: `specs/service-token-auth.md` §Scope 定义 的 endpoint → scope 唯一矩阵。

**简化清单**:
- `agent-definitions:read` / `agent-definitions:write`
- `agents:read` / `agents:write`(**Agent 层 CRUD,不包含 Run 操作**)
- `runs:read` / `runs:write` / `runs:cancel`
- `vaults:read` / `vaults:write`
- `projects:read` / `projects:write`
- `*`(仅 session 自动拥有,Service Token **禁止声明**)

Session 鉴权默认 `scopes = ['*']`(立场 A,无 RBAC);Service Token 必须显式声明 scopes。

## E2E 测试覆盖场景(task-18 必须覆盖)

1. **Service Token 鉴权**
   - 无 token → 401
   - 错 token → 401
   - 正确 token + 足够 scope → 200
   - 正确 token + 不足 scope → 403

2. **AgentDefinition CRUD + 版本化**
   - POST 创建 → v1
   - PATCH 带正确 If-Match → v2
   - PATCH 带错 If-Match → 409
   - GET ?version=1 → v1 snapshot
   - GET /versions → 两个版本
   - POST /archive → archivedAt 设置

3. **Agent + Run + Event 闭环**
   - POST /agents → 自动创建 Agent + 第一个 Run
   - GET /events SSE → 收到 text-delta / tool-* / data-openrush-run-done
   - POST /runs(追加消息)→ 新 run 创建
   - GET /events with Last-Event-ID → 从断点继续
   - POST /cancel → status=cancelled

4. **幂等性**
   - POST /runs with Idempotency-Key=X → 200 创建
   - 重复相同 key + body → 返回同一 run
   - 相同 key + 不同 body → 409

5. **Vault**
   - POST → 加密存储
   - GET 不返回 encryptedValue
   - Agent 执行时通过 injectionTarget 注入 env

6. **乐观并发冲突**
   - 两个客户端 PATCH 同一 AgentDefinition
   - 一个 200,一个 409

## 版本策略

- URL 带 `/v1/`,非兼容变更走 `/v2/`
- 兼容扩展(新增字段)直接加,旧客户端忽略未知字段
- `/v1/` 发布后承诺维护 ≥ 6 个月(即使 v2 发布)

## 与 Web UI 关系

**`/api/v1/*` 是对外合约,也是 Web UI 主要数据来源**:
- Web UI 通过 NextAuth session 调 `/api/v1/*`(task-19 前端迁移后)
- 非 v1 路径(例如 `/api/skills/[id]/star`)为 Web UI 专属动作,不对 Service Token 开放

Web UI 专属动作列表(不走 v1):
- `POST /api/skills/:id/star` — 收藏
- `POST /api/mcps/:id/install` — 安装到项目
- `PATCH /api/projects/:id/members/:userId` — 管理成员
- `POST /api/chat/:id/generate-title` — 生成对话标题(UI 辅助)

这些在 task-19 中保留,仅移除路径重复的部分。

## 相关 spec

- `specs/service-token-auth.md` — 鉴权详细机制
- `specs/agent-definition-versioning.md` — 版本化语义
- `specs/vault-design.md` — Vault 加密 / 注入模式(已有)
- `specs/stream.md` — StreamRegistry Redis 流(已有)
- `specs/contracts.md` — Zod schema 约定(已有)
