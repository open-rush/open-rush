# Architecture Reference (managed-agents-p0-p1)

架构参考,供 agent team 在实现过程中随时查阅。本文件不是设计决策的 source of truth(那是 `specs/*` 和 `.claude/plans/managed-agents-p0-p1.md`),仅做快速索引。

## 系统流

```
外部调用方 (rush-app / CLI / 第三方 SDK)
        │
        │ Authorization: Bearer sk_xxx
        ▼
┌─────────────────────────────────────────────────────────────┐
│ apps/web (Next.js 16)                                       │
│                                                              │
│  /api/v1/*         <── 稳定对外合约,双轨鉴权                │
│  /api/auth/*       <── NextAuth(保留)                      │
│  /api/health       <── 健康检查(保留)                      │
│  /api/*(其他非 v1 部分) <── Web UI 私有,只 session        │
│       (install/star/members/generate-title 等)              │
│                                                              │
│  lib/auth/unified-auth.ts                                   │
│    authenticate(req) → AuthContext | null                   │
│                                                              │
└────────────┬────────────────────────────────────────────────┘
             │
             │ 共享业务逻辑
             ▼
┌─────────────────────────────────────────────────────────────┐
│ packages/control-plane                                      │
│   AgentDefinitionService  (版本化 + 乐观并发)               │
│   AgentService            (创建 tasks + 初始 run)           │
│   RunService              (状态机 + 幂等 + 版本绑定)        │
│   EventStore              (run_events 读写 + SSE 接入)       │
│   VaultService(已有)      (加密 + 注入)                     │
│   TokenService(新)        (service_tokens 颁发 + 校验)      │
└────────────┬────────────────────────────────────────────────┘
             │ pg-boss enqueue
             ▼
┌─────────────────────────────────────────────────────────────┐
│ apps/control-worker                                         │
│   消费队列,驱动 RunStateMachine,注入 data-openrush-* 事件  │
└────────────┬────────────────────────────────────────────────┘
             │ HTTP + SSE①
             ▼
┌─────────────────────────────────────────────────────────────┐
│ apps/agent-worker(沙箱内)                                   │
│   Claude Agent SDK streamText                               │
│   输出 AI SDK UIMessagePart                                 │
│   → 按 seq 写 run_events                                    │
│   → 同时通过 StreamRegistry pub 到 Redis                    │
└─────────────────────────────────────────────────────────────┘
```

## 数据模型对应

```
AgentDefinition (API)  ←→  agents 表 (DB) + agent_definition_versions
Agent           (API)  ←→  tasks 表 (DB)
Run             (API)  ←→  runs 表 (DB)
Event           (API)  ←→  run_events 表 (DB)
Vault           (API)  ←→  vault_entries 表 (DB)
ServiceToken    (API)  ←→  service_tokens 表 (DB)
```

## 事件流详细

### 写路径(**单写者模型**: agent-worker → SSE① → control-worker → DB + Redis)

```
Claude Agent SDK streamText
  │
  ▼ UIMessagePart
agent-worker
  │
  ▼ SSE①(不直接写 DB)
control-worker (Agent Bridge + EventStore)
  │
  ├─→ write run_events(单一 seq 分配,Advisory Lock / SERIALIZABLE)
  └─→ StreamRegistry.publish(Redis pub/sub,给 SSE② 消费)
```

**关键**:`run_events` 只由 control-worker 写入,保证 `(run_id, seq)` UNIQUE 约束不冲突。
control-worker 注入的 `data-openrush-*` 扩展事件共享同一 EventStore + seq 分配。

### 读路径(Web API → browser / SDK)

```
GET /api/v1/agents/:id/runs/:runId/events
  Last-Event-ID: N
  │
  ▼
SSE Handler
  │
  ├─ if run active:
  │    1. SELECT * FROM run_events WHERE run_id=? AND seq > N
  │    2. 写出历史
  │    3. 订阅 Redis live,转发新事件
  │    4. run.status 变结束态 → close
  │
  └─ if run finished:
       1. SELECT 全量 > N
       2. 写出后 close
```

## 命名对照速查

| 场景 | 名字 |
|---|---|
| "帮我做一个博客"(用户说) | Agent(= tasks 表一行) |
| "landing-page-builder v3"(蓝图) | AgentDefinition(= agents 表 + agent_definition_versions v3) |
| "agent 第一次执行""追加消息触发第二次"| Run(= runs 表多行) |
| "text-delta / tool-Read / data-openrush-run-done" | Event(= run_events 表多行) |
| 凭证 | Vault Entry(= vault_entries 表) |
| API 鉴权 token | Service Token(= service_tokens 表) |

## 关键文件导航

```
方案:
  .claude/plans/managed-agents-p0-p1.md

Spec:
  specs/managed-agents-api.md           API shape
  specs/agent-definition-versioning.md  版本化语义
  specs/service-token-auth.md           鉴权机制
  specs/vault-design.md                 Vault(已有)
  specs/stream.md                       Redis SSE(已有)
  specs/contracts.md                    Zod 约定(已有)

Agent 协调:
  docs/execution/TASKS.md               任务清单
  docs/execution/verify.sh              验证脚本
  docs/execution/progress/<agent>.md    进度记录(agent 自己维护)
  docs/execution/current_tasks/*.lock   任务认领

核心实现(待 agent 填充):
  packages/db/src/schema/
    agent-definition-versions.ts (task-1)
    service-tokens.ts            (task-2)
    runs.ts                      (task-3 扩展)
  packages/contracts/src/v1/     (task-4)
  apps/web/lib/auth/unified-auth.ts (task-5)
  packages/control-plane/src/
    agent-definition-service.ts  (task-7)
    run-service.ts               (task-11 改造)
  apps/web/app/api/v1/*          (task-6/8/9/12/13/14)
  apps/agent-worker/src/*        (task-10)
  packages/sdk/                  (task-16 新包)
  apps/web/app/**/*.tsx          (task-19 前端迁移)
```

## Sparring Review 快速入口

```bash
diff_content=$(git diff origin/main)
HTTP_PROXY= HTTPS_PROXY= agent --print --trust --model gpt-5.3-codex-xhigh \
  "Review this diff for task <task-id>.
Plan: .claude/plans/managed-agents-p0-p1.md
Specs: specs/managed-agents-api.md, specs/agent-definition-versioning.md, specs/service-token-auth.md
Scope boundary: <该 task 的文件域>

Diff:
${diff_content}

Respond with APPROVE or CONCERNS (each with MUST-FIX / SHOULD-FIX / NIT)."
```
