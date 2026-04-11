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

## 变更流程（Spec-First）

**按变更规模选择流程：**

### Small（不改变行为）
```
改代码 → typecheck + lint → 跑相关测试 → 提交
```
例：修 typo、调样式、改文案、配置调整

### Medium（有逻辑变更，影响可控）
```
1. 检查已有 Spec（有则读，作为行为参考）
2. 实现代码 + 同步写测试
3. 如果改变了已有 Spec 描述的行为 → 更新 Spec
4. typecheck + lint + test
5. 提交
```
例：新增 API 端点、新组件、功能扩展、有逻辑的 bug fix

### Large（新模块、架构变更、跨多 package）
```
1. 写/更新 Spec（行为契约，GWT 格式）
2. 从 Spec 拆测试用例 → TDD 实现
3. typecheck + lint + test
4. 更新 Spec 状态
5. 提交
```
例：新系统（control-plane）、重大重构

### Bug 修复
```
1. 分析根因
2. 写失败测试复现 bug（Red Test）
3. 修复代码使测试通过（Green）
4. 如果修复改变了 Spec 行为 → 更新 Spec
5. typecheck + lint + test
6. 提交
```

### Spec 文件

位置：`specs/` 目录。

| 写入 Spec | 不写入 Spec |
|-----------|------------|
| 用户行为和系统响应（GWT 格式） | CSS 类名、像素值 |
| 数据结构和 API 契约 | 内部函数签名 |
| 状态转换规则和边界条件 | 实现顺序 |
| 错误场景和降级策略 | 样式细节 |

Spec 是**验收标准**，不是实现说明书。

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

### 提交前门禁

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
✅ 可以提交
```

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
