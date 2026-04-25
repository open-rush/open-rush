# Plan: Managed Agents Platform — P0 + P1

**状态**: Draft,待 Sparring Review
**负责范围**: Open-rush 从"企业级 agent 基础设施"演进为"Open-source managed agents platform for Claude Code",实现稳定对外 `/api/v1/*` 合约、AgentDefinition 版本化、Service Token 鉴权、AI SDK UIMessage 事件流、Vault 外部 API。
**不在本次范围**: Warm container pool、Audit API、配额强制、OTEL 闭环、Environment 一等概念、Memory/KB(这些属于 P2+,单独立项)。
**工期**: 约 5.5-6 周,3 个 agent 并行。

---

## 1. 战略定位

对标 `openclaw-managed-agents`(Claude Code 方向的自托管 managed agents),差异化 = **一站式 Registry(Agents / MCPs / Skills 自带)+ 企业级 PostgreSQL + AI SDK UIMessage 原生事件流**。

README slogan:
> "Run managed agents on your own infrastructure. Claude Code native. Registry included."

---

## 2. 核心决策(已锁定)

| 决策 | 值 | 备注 |
|---|---|---|
| API 路径前缀 | `/api/v1/*` | 为未来 v2 留位置,对齐业界 SaaS(Stripe/Anthropic/Stainless 风格) |
| Legacy API 处理 | **直接替换,不保留** | 合入新 API 时原子删除旧 route + 前端跟进同 PR |
| 前端迁移 | 作为 task-19 加入 M4 | 和 API 重写同步,不留两套 |
| 鉴权 | 双轨(NextAuth Session + Service Token) | 同 endpoint 两种识别,立场 A:Session 默认全权限 |
| Registry 暴露范围 | 只暴露只读 CRUD | install/star/members 等 UI 专属动作不对 Service Token 开放 |
| 事件流格式 | AI SDK UIMessage Stream Part | 前端 `useChat` 零改动;run_events.payload 直接存 UIMessagePart |

---

## 3. 四层概念栈(最终锁定,贯穿代码/spec/文档)

| 层 | 名字 | 现有表 | 含义 |
|---|---|---|---|
| 1 | **AgentDefinition** | `agents` | 蓝图 / 配置,可复用、版本化、不可变(每次 PATCH 产生新 version) |
| 2 | **Agent** | `tasks` | 一次需求 / 任务 / 业务调用,绑定某 AgentDefinition@version |
| 3 | **Run** | `runs` | Agent 内部一次具体执行,可能多次(追加消息、子任务、重试) |
| 4 | **Event** | `run_events` | Run 内的流式事件,AI SDK UIMessage 格式 |

**命名冲突提示**: open-rush 数据库层的 `agents` 表 = **AgentDefinition 层**(注意不是 Agent 层)。这是历史原因,API 层通过 `/api/v1/agent-definitions` 暴露,内部代码可维持现状不强制 rename。

---

## 4. 数据模型变更

### 4.1 新增表

**agent_definition_versions** — AgentDefinition 的不可变历史
```sql
CREATE TABLE agent_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,           -- 该版本完整 agent 字段快照
  change_note text,                   -- 可选 commit message
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
CREATE INDEX agent_definition_versions_agent_idx
  ON agent_definition_versions(agent_id, version DESC);
```

**service_tokens** — 外部 API 鉴权
```sql
CREATE TABLE service_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,   -- SHA256(raw_token)
  name varchar(255) NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_tokens_owner_idx ON service_tokens(owner_user_id);
CREATE INDEX service_tokens_active_idx ON service_tokens(token_hash)
  WHERE revoked_at IS NULL;
```

### 4.2 现有表扩展

**agents** (= AgentDefinition 层)
```sql
ALTER TABLE agents
  ADD COLUMN current_version integer NOT NULL DEFAULT 1,
  ADD COLUMN archived_at timestamptz;
```
migration 同时为现有 agents 初始化 v1 snapshot:
```sql
INSERT INTO agent_definition_versions (agent_id, version, snapshot, created_at)
SELECT id, 1, to_jsonb(agents.*) - 'id' - 'created_at' - 'updated_at', created_at
FROM agents;
```

**tasks** — Agent 层绑定版本
```sql
ALTER TABLE tasks ADD COLUMN definition_version integer;
-- 回填存量 tasks.definition_version = 1(详见 specs/agent-definition-versioning.md)
UPDATE tasks SET definition_version = 1
WHERE agent_id IS NOT NULL AND definition_version IS NULL;
```

**runs** — Run 层继承版本 + 幂等(详见 specs/managed-agents-api.md 幂等章节)
```sql
ALTER TABLE runs
  ADD COLUMN agent_definition_version integer,
  ADD COLUMN idempotency_key varchar(255),
  ADD COLUMN idempotency_request_hash varchar(64);

CREATE INDEX runs_idempotency_lookup_idx
  ON runs(idempotency_key, created_at DESC)
  WHERE idempotency_key IS NOT NULL;

-- 回填 agent_definition_version 从 tasks 级联
UPDATE runs SET agent_definition_version = t.definition_version
FROM tasks t WHERE runs.task_id = t.id AND runs.agent_definition_version IS NULL;
UPDATE runs SET agent_definition_version = a.current_version
FROM agents a WHERE runs.agent_id = a.id AND runs.agent_definition_version IS NULL;
```

**注**: `runs.idempotency_key` 不做 UNIQUE 约束,24h 窗口由应用层 + index + SERIALIZABLE 事务保证。仅 `POST /runs` 启用幂等;其他 POST 不保证。

### 4.3 向后兼容

所有变更**只新增,不删列**。legacy 代码继续工作;task-19 前端迁移完成后,旧 API handler 文件被删除。

---

## 5. API 对外合约(24 endpoints)

详细 shape 见 `specs/managed-agents-api.md`(同 PR 产出)。本节仅列清单。

```
# Auth
POST   /api/v1/auth/tokens
GET    /api/v1/auth/tokens
DELETE /api/v1/auth/tokens/:id

# AgentDefinition
POST   /api/v1/agent-definitions
GET    /api/v1/agent-definitions
GET    /api/v1/agent-definitions/:id
PATCH  /api/v1/agent-definitions/:id
GET    /api/v1/agent-definitions/:id/versions
POST   /api/v1/agent-definitions/:id/archive

# Agent (Task)
POST   /api/v1/agents
GET    /api/v1/agents
GET    /api/v1/agents/:id
DELETE /api/v1/agents/:id

# Run
POST   /api/v1/agents/:id/runs
GET    /api/v1/agents/:id/runs
GET    /api/v1/agents/:id/runs/:runId
GET    /api/v1/agents/:id/runs/:runId/events     (SSE, Last-Event-ID)
POST   /api/v1/agents/:id/runs/:runId/cancel

# Vault
POST   /api/v1/vaults/entries
GET    /api/v1/vaults/entries
DELETE /api/v1/vaults/entries/:id

# Registry (只读)
GET    /api/v1/skills
GET    /api/v1/mcps

# Projects (最小 CRUD)
POST   /api/v1/projects
GET    /api/v1/projects
GET    /api/v1/projects/:id
```

---

## 6. 双轨鉴权

```
请求到达 /api/v1/* →
  1. 有 Authorization: Bearer sk_* → Service Token 校验
     - SHA256 hash → 查 service_tokens → 校验 scope → 通过
  2. 有 NextAuth session cookie → session 校验
     - authType=session,scopes=['*'] (立场 A,无 RBAC)
  3. 都没有 → 401

Web UI 专属 route (非 /api/v1/) → 只接受 session,拒绝 Service Token
```

详见 `specs/service-token-auth.md`。

---

## 7. AI SDK UIMessage 事件流

### 7.1 存储

`run_events.payload` 直接存 AI SDK UIMessagePart:
```typescript
type RunEventPayload =
  | { type: "text-delta"; textDelta: string }
  | { type: "reasoning"; text: string }
  | { type: "step-start" }
  | { type: "step-finish"; finishReason: string; usage: {...} }
  | { type: `tool-${string}`; toolCallId: string; state: "call"|"result"; input?; output? }
  | { type: `data-${string}`; id?: string; data: unknown }
  // Open-rush 扩展(走 data-openrush-* 前缀)
  | { type: "data-openrush-run-started"; data: { runId, agentId, definitionVersion } }
  | { type: "data-openrush-run-done"; data: { status, error? } }
  | { type: "data-openrush-usage"; data: { tokensIn, tokensOut, costUsd } };
```

### 7.2 SSE 端点行为

- `GET /api/v1/agents/:id/runs/:runId/events`
- Header `Last-Event-ID: N` → `SELECT * FROM run_events WHERE run_id = ? AND seq > N ORDER BY seq`,先 replay 再接入 live stream
- 活跃 run: 订阅 Redis pub/sub(StreamRegistry)转发
- 结束 run: 全量 replay 后关闭连接

### 7.3 事件写入架构(单写者模型)

**核心决策**: **`run_events` 只由 control-worker 写**,agent-worker 通过 SSE① 把 UIMessagePart 推给 control-worker,由后者统一分配 `seq` 并持久化。

理由:
- `run_events (run_id, seq)` 的 UNIQUE 约束需要单一 seq 分配权
- agent-worker + control-worker 双写易产生 seq 冲突或乱序,破坏 SSE 断点重放正确性
- 单写者模型与现有"agent-worker → control-worker SSE① → DB + Redis"的三层架构天然一致(见 AGENTS.md 双层 SSE 协议)

**分配流程**:
1. agent-worker 产生 UIMessagePart(Claude Agent SDK 流式输出)
2. agent-worker 通过 SSE① 推给 control-worker(已有链路)
3. control-worker 的 EventStore 在**同一 DB 事务**内:
   a. `SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ? FOR UPDATE` (悲观锁) 或使用 PostgreSQL sequence per-run(推荐后者,见下)
   b. `INSERT INTO run_events (run_id, seq, event_type, payload, ...)`
4. 插入成功 → 发 Redis pub/sub 通知订阅者(SSE② 消费)

**推荐实现: per-run sequence via row-level 自增**

```sql
-- 每次写事件用一条原子 SQL 完成 seq 分配
INSERT INTO run_events (run_id, seq, event_type, payload, ...)
SELECT
  $1,
  COALESCE((SELECT MAX(seq) FROM run_events WHERE run_id = $1), 0) + 1,
  $2, $3, ...
RETURNING seq;
```

在 SERIALIZABLE 隔离级别下执行,或使用 Advisory Lock(`pg_advisory_xact_lock(hashtext(run_id::text))`)保证同 run 串行。

**control-worker 扩展事件**: `data-openrush-run-started/done/usage` 等由 control-worker 在状态机切换时通过同一 EventStore 写入,共享同一 seq 分配机制。

**agent-worker 改造点**(task-10):
- **不直接写 `run_events`**
- 保持 SSE① 输出为 UIMessagePart 格式(已有)
- control-worker 侧 Agent Bridge 消费 SSE①,调 EventStore 持久化

**run_events.payload 存 UIMessagePart 原格式,`event_type` 存 `type` 字段便于查询**。

详见 `specs/managed-agents-api.md` §事件协议。

---

## 8. Milestone 与 Task 拆分

### M1: Foundation (W1-W2) — 6 task,必须先完成

| # | Task | 文件域 | 依赖 | Est |
|---|---|---|---|---|
| 1 | Schema: agent_definition_versions + agents 字段 | packages/db/src/schema/agent-definition-versions.ts, packages/db/drizzle/*.sql | - | 2d |
| 2 | Schema: service_tokens | packages/db/src/schema/service-tokens.ts, migration | - | 1d |
| 3 | Schema: runs extension (version + idempotency_key) | packages/db/src/schema/runs.ts, migration | - | 0.5d |
| 4 | Contracts: `/api/v1/*` Zod types | packages/contracts/src/v1/*.ts, specs/managed-agents-api.md | 1,2,3 | 2.5d |
| 5 | Middleware: unified authenticate (session + service token) | apps/web/lib/auth/unified-auth.ts | 2 | 1.5d |
| 6 | API: `/api/v1/auth/tokens` CRUD | apps/web/app/api/v1/auth/tokens/*, service | 5 | 1d |

### M2: Registry API (W2-W3) — 3 task

| # | Task | 文件域 | 依赖 | Est |
|---|---|---|---|---|
| 7 | Service: AgentDefinitionService (PATCH 版本化 + 乐观并发) | packages/control-plane/src/agent-definition-service.ts | 1,4 | 2d |
| 8 | API: `/api/v1/agent-definitions/*` 6 endpoint | apps/web/app/api/v1/agent-definitions/* | 7 | 2d |
| 9 | API: `/api/v1/vaults/entries/*` 3 endpoint | apps/web/app/api/v1/vaults/entries/* | 4 | 1.5d |

### M3: Runtime API (W3-W4) — 5 task

| # | Task | 文件域 | 依赖 | Est |
|---|---|---|---|---|
| 10 | Agent Worker: AI SDK UIMessage stream + data-openrush-* 扩展 | apps/agent-worker/src/*, packages/stream/src/* | 4 | 3d |
| 11 | Service: Run 状态机幂等 + definition version 绑定 | packages/control-plane/src/run-service.ts | 3,4 | 2d |
| 12 | API: `/api/v1/agents/*` 4 endpoint(创建 = 新建 task + 第一个 run) | apps/web/app/api/v1/agents/* | 4,7,11 | 2d |
| 13 | API: `/api/v1/agents/:id/runs/*` 3 endpoint | apps/web/app/api/v1/agents/[agentId]/runs/* | 11,12 | 1.5d |
| 14 | API: SSE `/events` + Last-Event-ID | apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/* | 10,13 | 2d |

### M4: SDK + Docs + Frontend (W4-W5) — 5 task

| # | Task | 文件域 | 依赖 | Est |
|---|---|---|---|---|
| 15 | OpenAPI v0.1 spec YAML + 自动校验脚本 | docs/specs/openapi-v0.1.yaml, scripts/validate-openapi.ts | all APIs | 1.5d |
| 16 | TypeScript SDK `@open-rush/sdk` | packages/sdk/* | 4, openapi | 3d |
| 17 | README v2 + quickstart + api docs | README.md, docs/quickstart.md, docs/api.md | all | 2d |
| 18 | E2E 集成测试 | apps/web/e2e/v1-api.spec.ts + scripts | all APIs | 2d |
| 19 | 前端迁移到 /api/v1/* + 删除 legacy routes | apps/web/app/**/*.tsx, 删 apps/web/app/api/[legacy]/* | 8,9,12,13,14 | 3-5d |

**合计**: 19 task, 约 35 人天, 3 人并行 5.5-6 周。

---

## 9. Agent Team 协调机制

### 9.1 文件冲突域(三个并行 agent)

**Agent-0 (Foundation, 必须先完成 M1)**:
- packages/db/src/schema/*.ts
- packages/db/drizzle/*.sql
- packages/contracts/src/v1/*.ts
- apps/web/lib/auth/unified-auth.ts
- specs/managed-agents-api.md (包括 API shape, event schema)
- specs/agent-definition-versioning.md
- specs/service-token-auth.md

**Agent-A (Registry + Auth, M1 完成后并行)**:
- apps/web/app/api/v1/auth/*
- apps/web/app/api/v1/agent-definitions/*
- apps/web/app/api/v1/vaults/*
- packages/control-plane/src/agent-definition-service.ts

**Agent-B (Runtime + Worker, M1 完成后并行)**:
- apps/agent-worker/src/*
- apps/web/app/api/v1/agents/*
- packages/control-plane/src/run-service.ts
- packages/stream/src/* (if needed)

**Agent-C (SDK + Docs + Frontend, 最后收尾)**:
- packages/sdk/*
- docs/specs/openapi-v0.1.yaml
- docs/quickstart.md, docs/api.md
- README.md
- apps/web/e2e/*
- apps/web/app/**/*.tsx (前端页面组件, task-19)
- 删除 legacy apps/web/app/api/[非 v1 / 非 auth / 非 health]/*

**边界约定**:
- Agent-B 不碰 apps/web/app/**/*.tsx(前端)
- Agent-C 不碰 apps/web/app/api/v1/*(新 API)
- 删除 legacy API 由 Agent-C 在 task-19 统一完成(与前端迁移原子)
- `packages/control-plane/src/` 每个 service 文件一个 agent 改,避免交叉

### 9.2 任务认领协议

- 认领: 创建 `docs/execution/current_tasks/<task-id>.lock`(内容写 agent 名)
- 进度: 更新 `docs/execution/progress/<agent-name>.md`(关键决策 + 失败原因,不贴完整日志)
- 完成: 删 lock,commit + push,勾选 TASKS.md checkbox

详见 `docs/execution/TASKS.md` 和 `docs/execution/verify.sh`。

### 9.3 Sparring 铁律

每个 PR 必须通过 Cursor Agent 或 Codex code review:
- APPROVE 才能合
- MUST-FIX 必修,SHOULD-FIX 评估,NIT 可忽略
- 最多 5 轮,未通过升级人工 review

见 AGENTS.md "Sparring Review" 章节,本 plan 不复述。

---

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| agent-worker 事件流格式改造影响现有 stream | task-10 通过 feature flag `OPENRUSH_V1_EVENTS_ENABLED` 控制,默认关;task-19 合入前一直关 |
| Service Token 泄漏 | 创建时只返回一次,DB 存 SHA256 hash,提供吊销 API + 护栏(非 *、必过期、上限 20) |
| 并发 agent 搞坏 migration 顺序 | 所有 migration 集中在 M1 (task-1/2/3) 一次做完,后续禁止加 migration |
| 删除 legacy API 导致前端挂 | task-19 强制原子(删除 + 前端迁移同 PR + E2E 覆盖) |
| Sparring 卡住 | 5 轮未过升级人工 |
| AgentDefinition 版本历史膨胀 | 加 (agent_id, version DESC) 索引,未来 P2 加归档策略 |

### 发布策略(明确,避免回滚冲突)

**所有 task 使用独立 PR,可独立 revert**。跨 task 耦合通过 **feature flag** 管理:

- 引入单一环境变量 `OPENRUSH_V1_ENABLED`(boolean,默认 **false**)
- task-6 到 task-14 的 `/api/v1/*` 实现完成后逐步合入 main,但 endpoint 层增加 guard:flag 关时返回 503
- task-15/16/17/18 开发 docs/SDK/E2E,不受 flag 影响
- task-19(前端迁移 + legacy 清理)**最后合入**:
  - PR 内容 = 前端全部迁到 /api/v1/ + 删除 legacy + **打开 flag 默认 true**
  - E2E 作为 merge gate
- 出问题 → 关 flag(`OPENRUSH_V1_ENABLED=false`)→ 前端失败但 legacy 已被删(**这是已知代价**)
  - 备用:task-19 分两步合,第一步只迁前端保留 legacy,观察 1 天,第二步删 legacy
  - 推荐按"两步"执行,回滚风险最小

### 回滚能力矩阵

| task | 独立 revert | 保留数据? | 备注 |
|---|---|---|---|
| task-1/2/3 migration | 提供 down SQL | 是(新表为空或有 v1 snapshot) | revert 前需确保无 v1 API 依赖 |
| task-4 contracts | 独立 revert 安全 | n/a | |
| task-5/6/7/8/9/11/12/13/14 API/service | 关 flag 等同 revert | n/a | 受 flag 保护 |
| task-10 worker 输出 | 关 flag 退回旧 path | DB 旧 run_events 不变 | |
| task-19 前端迁移 + legacy 删除 | **建议分两步合**,第一步可 revert,第二步(删 legacy)revert 需要 `git revert` + 测试 | n/a | |

---

## 11. 完成后状态(Done Definition)

- [ ] 3 张新/改 migration 合入并生产可用
- [ ] 24 个 `/api/v1/*` endpoint 全部实现、文档、测试
- [ ] `specs/managed-agents-api.md` / `specs/agent-definition-versioning.md` / `specs/service-token-auth.md` 入库
- [ ] OpenAPI spec 自动校验 CI 通过
- [ ] `@open-rush/sdk` 0.1.0 可 publish(不强制发包,保证构建通过)
- [ ] README v2 能让新用户 3 分钟跑起来 quickstart
- [ ] 前端完全迁移到 `/api/v1/*`,旧 route 删除
- [ ] E2E 测试覆盖 6 个场景(见 specs/managed-agents-api.md 测试章节)
- [ ] 所有 PR 通过 Sparring review
- [ ] 19 个 GitHub Issue 全部 closed,4 个 Milestone 全部 closed

---

## 12. 后续(P2+,不在本次范围)

- Warm container pool(冷启动优化)
- Audit API + 不可篡改日志
- per-agent 配额强制(maxBudgetUsd, maxDurationSec enforcement)
- OTEL trace_id 跨层透传闭环
- Environment 一等概念(建站持久 workspace)
- Memory / Knowledge Base

---

*Plan 生效前必须通过 Sparring Review。*
