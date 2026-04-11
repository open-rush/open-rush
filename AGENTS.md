# AGENTS.md

AI coding agents（Claude Code, Cursor 等）在本仓库工作时的完整指南。

## Project Overview

Rush 是企业级 AI Agent 基础设施平台——自托管、多场景、为每一位团队成员而建。核心理念：**AI Agent 成为主要交互界面**，底层有正确的基础设施支撑。

核心特性：
- Claude Code 原生执行（Anthropic API / AWS Bedrock / 自定义端点）
- 可插拔沙箱隔离（OpenSandbox 默认，可切换 E2B / Docker）
- 双层凭据管理（Platform Vault + User Vault，env 注入沙箱）
- 15 状态 Run 状态机 + 断线恢复 + 断点续跑
- Redis-backed 可恢复 SSE 流（双层：agent→control, control→browser）
- Skills & MCP 插件生态
- 跨会话 Agent 记忆（pgvector）

## 三层架构

```
浏览器
  │ ← SSE② 流式返回
  ▼
┌─ apps/web（Next.js 16）──────────────────────────────────┐
│  用户界面 + 控制面 API + SSE 端点                          │
│                                                            │
│  职责：                                                     │
│  • 用户界面渲染（React 19）                                 │
│  • Control API（创建 Run、查询状态、SSE② 端点）            │
│  • 项目/用户 CRUD（直接操作 DB）                           │
│  • NextAuth.js v5 认证                                     │
│                                                            │
│  不做：                                                     │
│  ✗ 不执行 AI 模型调用                                      │
│  ✗ 不操作沙箱文件系统                                      │
│  ✗ 不处理 Agent 运行时逻辑                                 │
└───────────┬────────────────────────────────────────────────┘
            │ 入队 pg-boss job
            ▼
┌─ apps/control-worker（Node.js + pg-boss）──────────────────┐
│  任务编排 + 状态机驱动                                       │
│                                                              │
│  职责：                                                       │
│  • 消费 pg-boss 队列（run:execute, run:finalize）            │
│  • 驱动 RunStateMachine（15 状态转换）                       │
│  • 沙箱生命周期管理（通过 SandboxProvider）                  │
│  • Agent Bridge（SSE① 消费 + 事件持久化）                   │
│  • Finalization（workspace snapshot + PR + checkpoint）      │
│  • 定时恢复卡住的 Run（run:recover 每 2 分钟）              │
│                                                              │
│  不做：                                                       │
│  ✗ 不直接处理 HTTP 请求                                      │
│  ✗ 不渲染 UI                                                 │
└───────────┬──────────────────────────────────────────────────┘
            │ HTTP + SSE①（通过 SandboxProvider）
            ▼
┌─ apps/agent-worker（Hono :8787，在沙箱容器内）──────────────┐
│  AI 执行环境                                                  │
│                                                                │
│  职责：                                                         │
│  • 接收 prompt，调用 Claude Code                               │
│  • 工具执行（Bash, Read, Write, Edit 等）                     │
│  • SSE① 流式输出 UIMessageChunk                              │
│  • 断点恢复（接收 checkpoint，重建上下文）                     │
│  • 工作区文件系统操作                                          │
│                                                                │
│  约束：                                                         │
│  • 无状态（恢复数据来自 DB/OSS，不依赖进程内存）              │
│  • 凭据通过 env 注入，不持有明文密钥                          │
└────────────────────────────────────────────────────────────────┘
```

### 改代码时怎么判断改哪个？

| 你要改的东西 | 改 apps/web | 改 apps/control-worker | 改 apps/agent-worker |
|---|---|---|---|
| 页面 UI、组件、样式 | ✅ | | |
| 用户认证（NextAuth） | ✅ | | |
| 项目/用户 CRUD API | ✅ | | |
| SSE② 端点（browser ← control） | ✅ | | |
| Run 状态机转换逻辑 | | ✅ | |
| 沙箱创建/销毁 | | ✅ | |
| Finalization（PR 创建、产物上传） | | ✅ | |
| pg-boss 队列处理 | | ✅ | |
| AI 对话、Prompt 执行 | | | ✅ |
| 工具调用（Bash、文件操作） | | | ✅ |
| SSE① 流式输出 | | | ✅ |
| 断点恢复（restore） | | ✅ + ✅ | |

| 你要改的东西 | 改哪个 package |
|---|---|
| Zod schema、枚举、状态机 | packages/contracts |
| 数据库表结构、migration | packages/db |
| RunService、AgentService、EventStore | packages/control-plane |
| SandboxProvider 接口/实现 | packages/sandbox |
| AI Provider 抽象 | packages/agent-runtime |
| Redis SSE 流 | packages/stream |
| 外部服务集成（Git、OSS） | packages/integrations |
| AI UI 组件 | packages/ai-components |
| Skill 安装/管理 | packages/skills |
| MCP server/client | packages/mcp |
| 跨会话记忆 | packages/memory |

## Monorepo Structure

```
open-rush/
├── apps/
│   ├── web/              # Next.js 16 前端 + Control API
│   ├── control-worker/   # pg-boss 任务编排 + RunStateMachine
│   └── agent-worker/     # Hono HTTP server（沙箱内 AI 执行）
│
├── packages/
│   ├── contracts/        # Zod schema + 枚举 + 状态机（零运行时依赖）
│   ├── db/               # Drizzle ORM schema + PostgreSQL client
│   ├── control-plane/    # 业务逻辑（RunService, AgentService, EventStore）
│   ├── sandbox/          # SandboxProvider 接口 + OpenSandbox 默认实现
│   ├── agent-runtime/    # AI Provider 接口 + Claude Code 实现
│   ├── stream/           # Redis-backed resumable SSE（StreamRegistry）
│   ├── integrations/     # Git、OSS、Auth 外部服务
│   ├── ai-components/    # AI UI 组件（ChatView、ToolRenderer）
│   ├── skills/           # Agent Skill 系统
│   ├── mcp/              # Model Context Protocol server/client
│   └── memory/           # 跨会话 Agent 记忆（pgvector 向量搜索）
│
├── docker/               # Docker Compose（PG + Redis）
├── specs/                # 行为契约 Spec（GWT 格式）
├── AGENTS.md             # ← 你正在读的文件
└── CLAUDE.md             # 快速参考（指向本文件）
```

### 依赖关系图

```
contracts（根，零依赖）
├→ db, sandbox, agent-runtime, stream, integrations, memory
└→ control-plane（→ contracts, db, sandbox, stream）
   ├→ web（→ control-plane, db, stream, integrations）
   └→ control-worker（→ control-plane, sandbox, db, stream, integrations）

agent-worker（→ contracts, agent-runtime, hono）
```

## Run 生命周期（15 状态状态机）

```
queued → provisioning → preparing → running
  → finalizing_prepare → finalizing_uploading → finalizing_verifying
  → finalizing_metadata_commit → finalized → completed

异常路径:
  任意 → failed（大部分状态可直接失败）
  failed → queued（重试，retryCount < maxRetries）
  running → worker_unreachable → failed | running（恢复或失败）
  finalizing_* → finalizing_retryable_failed → finalizing_uploading | finalizing_timeout
  finalizing_timeout → finalizing_manual_intervention → failed
```

### 两条执行路径

| 路径 | 触发条件 | 流程 |
|------|---------|------|
| **Initial Run** | 无 parentRunId | provisioning → preparing（Git clone + 依赖安装）→ running → finalization |
| **Follow-up Run** | 有 parentRunId + completed parent | health check → restore（注入 checkpoint）→ running → finalization |

Follow-up 降级为 Initial：sandbox 不存在 / agent worker 不健康时自动回退。

### Finalization 强一致性门

所有步骤必须全部成功才能标记 completed：
1. Workspace snapshot 持久化到存储
2. Checkpoint 写入 run_checkpoints 表
3. Git diff/artifact 导出 + PR 创建（task mode）
4. Metadata commit 到 DB
5. Sandbox 不回收（recycle guard）

## 变更流程（Spec-First + Sparring Review）

**所有方案、代码变更、Spec 变更在提交前必须经过 Sparring Review（双 Agent 交叉审查）。这是铁律，无任何例外。**

### Sparring Review 是什么

Sparring 是 Claude Code + Cursor Agent 的双 Agent 交叉审查机制：
- **方案审查**：技术方案、架构决策、Spec 设计在定稿前，由另一个 Agent 独立审查
- **代码审查**：所有代码变更在 commit 前，提交完整 diff 给另一个 Agent review
- **结论审查**：任何涉及判断、推理、建议的输出，先 Sparring 再呈现给用户

### Sparring 的作用

| 不做 Sparring | 做了 Sparring |
|---|---|
| 方案盲区在实现后才暴露 | 方案阶段就发现漏洞 |
| 代码问题在 PR review 才发现 | commit 前就修复 |
| 结论可能有偏差 | 双视角交叉验证 |

### 什么必须 Sparring

| 必须 Sparring | 不需要 Sparring |
|---|---|
| 技术方案、架构决策 | 纯事实陈述（"这个文件在 src/xxx.ts"） |
| Spec 新增/修改 | 提问澄清 |
| 代码变更（任何规模） | 中间过程状态更新 |
| Bug 根因分析结论 | |
| 任何"我建议..."、"应该..."的输出 | |

### 按变更规模选择流程

#### Small（不改变行为）
```
改代码 → typecheck + lint → 跑相关测试 → Sparring review → 提交
```
例：修 typo、调样式、改文案、配置调整

#### Medium（有逻辑变更，影响可控）
```
1. 检查已有 Spec（有则读，作为行为参考）
2. 实现代码 + 同步写测试
3. 如果改变了已有 Spec 描述的行为 → 更新 Spec
4. typecheck + lint + test
5. Sparring review（完整 diff + Spec 变更）
6. 修复 Sparring 提出的 MUST-FIX
7. 提交
```
例：新增 API 端点、新组件、功能扩展、有逻辑的 bug fix

#### Large（新模块、架构变更、跨多 package）
```
Plan 阶段：
1. 写 Plan（实施方案、技术选型、任务拆分）
2. Sparring review Plan
3. 与用户确认

Spec 阶段（如果涉及方向性设计决策）：
4. 写/更新 Spec（状态机、流程、协议、架构约束）
5. Sparring review Spec
6. 修复问题

实现阶段：
7. 按 Plan 逐步实现，每步代码 + 测试
8. typecheck + lint + test
9. Sparring review 代码（完整 diff）
10. 修复 MUST-FIX
11. 提交
```
例：新系统（control-plane）、重大重构

#### Bug 修复
```
1. 分析根因
2. Sparring review 根因结论 ← 避免误判
3. 写失败测试复现 bug（Red Test）
4. 修复代码使测试通过（Green）
5. 如果修复改变了 Spec 行为 → 更新 Spec
6. typecheck + lint + test
7. Sparring review 代码
8. 提交
```

### Sparring Review 执行方式

使用 `/sparring:workflow` 或 `/sparring:yolo` 触发审查。或直接调用：

```bash
# 方案/结论审查
response=$(HTTP_PROXY= HTTPS_PROXY= agent --print --trust --model gpt-5.3-codex-xhigh "<review prompt>")

# 代码审查（自动提交 diff）
workflow review-code <task-id>
```

**Sparring 输出格式**：
- `APPROVE` — 通过
- `CONCERNS` — 有问题，每条标注 `MUST-FIX`（必须修）/ `SHOULD-FIX`（建议修）/ `NIT`（可忽略）

**处理规则**：
- `MUST-FIX` → 必须修复后重新 Sparring
- `SHOULD-FIX` → 评估后决定修或标记为已知问题
- `NIT` → 可选修复

### Plan 和 Spec

**Plan**（实施方案，会话级）：
- 技术选型、架构决策、任务拆分、文件清单、实施顺序
- 位置：`.claude/plans/` 或 `.workflow/plans/`
- 生命周期：实施完成后归档，不入库

**Spec**（设计决策，仓库级）：
- 记录**方向性选择**——流程、状态机、协议、架构约束
- 位置：`specs/` 目录，入库长期维护
- Spec 存在的意义：**让整体方向选择更清晰**，是团队对"我们选了什么、为什么这样选"的共识记录

| 写入 Spec | 不写入 Spec |
|-----------|------------|
| 状态机定义和转换规则 | 模块内部 API 签名 |
| 流程编排（Run 生命周期、Finalization、Recovery） | 具体函数实现 |
| 协议设计（SSE 双层、事件格式） | CSS / 样式 / UI 细节 |
| 架构约束和设计原则 | 配置项枚举 |
| 关键技术选型及理由 | 测试用例 |

**已有的 Spec**（参考）：
```
specs/
├── contracts.md     — Zod schema 设计决策（枚举定义、状态机、验证规则）
└── stream.md        — Redis SSE 流设计（StreamRegistry API、Redis 配置模式）
```

**后续应补的 Spec**（举例）：
```
specs/
├── run-lifecycle.md         — 15 状态状态机 + 两条执行路径 + 重试策略
├── finalization.md          — 强一致性门 + 4 步子状态机
├── recovery-protocol.md     — 断点恢复 + 3 种恢复路径 + 降级策略
├── sandbox-model.md         — SandboxProvider 接口 + 生命周期 + 双通道
└── vault-design.md          — 双层 Vault + env 注入 + 密钥轮换
```

Spec 不是实现说明书，是**设计决策的 source of truth**。改变方向时先改 Spec，再改代码。

**Spec 的新增和修改也必须 Sparring review。**

## 双层 SSE 协议

```
Agent Worker(:8787) ──SSE①──→ Control Worker ──Redis──→ Control API ──SSE②──→ Browser

SSE①: UIMessageChunk 流（agent-worker → control-worker）
  - 注册到 Redis via resumable-stream
  - runs.agent_stream_id 追踪
  - TTL 24 小时，过期后从 run_events 重建

SSE②: UIMessageChunk 流（control-api → browser）
  - 从 run_events 重建 + Redis 缓存
  - runs.active_stream_id 追踪
  - 浏览器传 streamId 断线重连
```

## 测试策略

### 双层测试

| 层级 | 引擎 | Docker | 速度 | 用途 |
|------|------|--------|------|------|
| PGlite 测试 | @electric-sql/pglite | 否 | ~100ms | Schema CRUD、FK 约束、业务逻辑 |
| Docker 集成 | pgvector/pgvector:pg16 | 是 | ~2s | pgvector、连接池、真实网络 |

### 测试要求

- **每个 commit 必须包含代码 + 测试**
- 提交前 `pnpm build && pnpm check && pnpm lint && pnpm test` 全部通过
- GitHub Actions CI 必须绿才能合并

### 什么时候写测试

| 场景 | 测试要求 |
|------|---------|
| 新增有逻辑的函数/模块 | 同步写测试 |
| 修改已有函数的行为 | 更新对应测试；若无则补写 |
| 修复有回归风险的 bug | 先写 Red Test 再修复 |
| 改文案、调样式、修 typo | 不需要新增测试 |
| 纯类型定义、配置常量 | 不需要测试 |

## 命令参考

```bash
# 开发
pnpm install              # 安装依赖
pnpm build                # 构建所有 packages 和 apps
pnpm dev                  # 启动所有开发服务器
pnpm dev:web              # 仅启动 Web

# 质量门禁
pnpm check                # TypeScript 类型检查
pnpm lint                 # Biome lint
pnpm format               # Biome format（自动修复）
pnpm test                 # 运行所有测试（PGlite，无需 Docker）
pnpm test:integration     # 运行集成测试（需要 Docker）

# 数据库
pnpm db:up                # 启动 PG + Redis（Docker Compose）
pnpm db:down              # 停止容器
pnpm db:reset             # 重置（删除数据 + 重建）
pnpm db:push              # 推送 schema 到 DB（开发用）
pnpm db:studio            # 打开 Drizzle Studio
```

## 代码约定

### 基础规范
- TypeScript strict mode，ESM only（`"type": "module"`）
- 禁止 `any`（Biome error 级别）
- Biome 格式化：2-space indent，单引号，trailing commas，分号
- Packages 通过 tsup 构建（双 ESM + CJS 输出）
- 工作区引用使用 `"workspace:*"`

### 提交前门禁（5 步，全部必须通过）

```
代码变更完成
    ↓
1. pnpm build → 构建失败 → 修复 → 重新构建
    ↓ 通过
2. pnpm check → 类型错误 → 修复 → 重新检查
    ↓ 通过
3. pnpm lint → lint 错误 → pnpm format 修复 → 重新检查
    ↓ 通过
4. pnpm test → 测试失败 → 修复 → 重新运行
    ↓ 通过
5. Sparring review → MUST-FIX → 修复 → 重新 Sparring
    ↓ APPROVE 或仅 SHOULD-FIX/NIT
✅ 可以提交
```

**跳过 Sparring 直接 commit = 违反铁律。** Hotfix、单行改动、文档修改、配置变更——全部需要 Sparring review。

## 关键架构文件

| 文件 | 职责 |
|---|---|
| `packages/contracts/src/enums.ts` | 所有枚举 + RunStatus 15 状态机 + 转换规则 |
| `packages/contracts/src/run.ts` | Run schema + RunSpec |
| `packages/db/src/schema/` | 13 张表的 Drizzle ORM 定义 |
| `packages/db/src/client.ts` | DB 连接 singleton（postgres 驱动） |
| `packages/stream/src/stream-registry.ts` | StreamRegistry（publish/resume/exists） |
| `packages/stream/src/redis-client.ts` | Redis 连接工厂（standalone + sentinel） |
| `docker/docker-compose.dev.yml` | PostgreSQL 16 (pgvector) + Redis 7 |
| `specs/` | 行为契约 Spec 目录 |
| `verify.sh` | 本地验证脚本 |

## 环境变量

```bash
# 数据库
DATABASE_URL=postgresql://rush:rush@localhost:5432/rush

# Redis
REDIS_URL=redis://localhost:6379

# AI（Claude Code）
ANTHROPIC_API_KEY=...                    # Anthropic API 直连
# 或 AWS Bedrock
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-west-2
ANTHROPIC_MODEL=...                      # Bedrock model ARN
```
