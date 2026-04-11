# Rush

**企业级 AI Agent 基础设施 —— 自托管、多场景、为每一位团队成员而建。**

## 为什么做 Rush

每个企业都在思考如何让 AI Agent 真正投入工作。当前的选择：锁定某个厂商的云服务、拼凑脆弱的工具链、或者从零构建。

Rush 走一条不同的路。**在你自己的基础设施上部署一次，然后让所有人——研发和非研发——都能用 AI Agent 完成日常工作。** 研发通过 CLI 和 API 自动化。产品团队通过对话构建应用。数据团队用自然语言做分析。所有任务运行在沙箱化的 Claude Code Agent 中，凭据加密管理、权限严格控制、数据不离开你的网络。

我们相信企业软件的未来不是"在现有工具上嵌入 AI 功能"——而是 **AI Agent 成为主要交互界面**，底层有正确的基础设施支撑：沙箱隔离执行、凭据安全管理、插件化能力扩展、可观测的运维体系。

Rush 就是这个基础设施，开源。

## 对标

Rush 不是某个单一工具的替代品，而是将多个场景统一在一个自托管平台中：

| 场景 | 对标产品 | Rush 的差异 |
|------|---------|-----------|
| AI 建站 | [bolt.new](https://bolt.new), [Lovable](https://lovable.dev), [v0](https://v0.dev) | 自托管、不只是建站、企业级权限和凭据管理 |
| AI 编码 | [Cursor](https://cursor.com), [Windsurf](https://windsurf.com) | 不是 IDE 插件，是平台级服务，非研发也能用 |
| Agent 运行时 | [Anthropic Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), [E2B](https://e2b.dev) | 自托管、可插拔沙箱、不锁定云厂商 |
| Agent 编排 | [LangGraph](https://www.langchain.com/langgraph), [CrewAI](https://www.crewai.com) | 内置沙箱执行环境，不只是编排框架 |
| 企业 AI 平台 | 各厂商私有方案 | 开源、Claude Code 原生、Skills/MCP 插件生态 |

**一句话：别人做的是某个场景的工具，Rush 做的是承载所有场景的企业基础设施。**

## 愿景

```
                              Rush
                    ┌──────────────────────┐
                    │   AI Agent 基础设施    │
入口                │                      │        场景
                    │  ┌────────────────┐  │
 Web UI (所有人) ───┤  │ Agent 编排     │  ├──► 应用构建
 CLI   (研发)   ───┤  │ 沙箱隔离       │  ├──► 代码生成
 API   (系统集成)───┤  │ Skills & MCP   │  ├──► 数据分析
 SDK   (嵌入产品)───┤  │ Memory         │  ├──► 工作流自动化
                    │  │ Vault          │  ├──► 文档生成
                    │  │ 可观测性       │  ├──► 多模态任务
                    │  └────────────────┘  │
                    └──────────────────────┘
                         你的基础设施
```

**当前 scope（M0–M4）：** 平台层 + 应用构建场景 + Web UI 入口。CLI、API、SDK 及更多场景在 GA 之后推进。

## 架构

三层设计，沙箱可插拔：

```
Browser / CLI / API
  │
  │  SSE (流式传输)
  ▼
apps/web (Next.js 16)          — 用户界面 + 控制面 API
  │
  │  pg-boss 任务队列
  ▼
apps/control-worker             — 编排引擎 + 15 状态机
  │
  │  SandboxProvider 接口
  ▼
沙箱容器
  ├── apps/agent-worker (Hono)  — Claude Code 执行
  ├── 工作区文件
  └── 开发服务器
```

## 平台能力

| 能力 | 说明 |
|------|------|
| **Agent 编排** | 对话、任务分发、15 状态机、断点恢复 |
| **沙箱隔离** | 每任务独立容器，可插拔运行时（OpenSandbox、E2B、Docker...） |
| **Skills & MCP** | 插件市场 + Model Context Protocol 服务器 |
| **Memory** | 跨会话学习、用户偏好、向量搜索 |
| **Vault** | 双层凭据管理 —— 平台级（运维）+ 用户级（自助），自动安全注入 |
| **多租户** | 用户隔离、项目隔离、RBAC 权限 |
| **可观测性** | OpenTelemetry traces + metrics + LLM 成本追踪 |

## 设计原则

- **自托管优先** —— 你的数据、你的基础设施、你的规则
- **沙箱可插拔** —— `SandboxProvider` 接口，自带容器运行时
- **Claude Code 原生** —— 三种连接模式：Anthropic API / AWS Bedrock / 自定义端点
- **安全默认** —— Credential Proxy 实现零密钥容器，双层 Vault
- **零供应商锁定** —— 标准 OTEL、NextAuth.js、S3 兼容存储、Drizzle ORM

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 16, React 19, Tailwind 4, shadcn/ui |
| 后端 | Hono (agent), pg-boss (队列), Drizzle ORM |
| AI | Claude Code (Anthropic API / Bedrock / 自定义端点) |
| 数据库 | PostgreSQL 16 + pgvector |
| 沙箱 | 可插拔 SandboxProvider |
| 缓存 | Redis (可恢复 SSE 流) |
| 存储 | S3 兼容 (MinIO / AWS) |
| 认证 | NextAuth.js v5 |
| 可观测 | OpenTelemetry |

## 里程碑

| 里程碑 | 时间 | 重点 |
|-------|------|------|
| M0: 骨架 | Week 2 | 基础设施、沙箱 PoC、安全基线 |
| M1: Agent 闭环 | Week 5 | 沙箱内 Claude Code 执行、流式输出到浏览器 |
| M2a: MVP 核心 | Week 9 | 创建 → 对话 → 生成代码 → 预览 → 部署 |
| M2b: 体验增强 | Week 11 | AI 组件库、Vault、模板系统 |
| M3: 生态 | Week 15 | Skills、MCP、Memory |
| M4: GA | Week 18 | OTEL 增强、RBAC、E2E、文档、生产硬化 |

完整计划见 [Roadmap](docs/roadmap.md)。

## 快速开始

```bash
# 前置：Node.js 22+, pnpm, Docker

docker compose up -d    # PostgreSQL, Redis, MinIO, 沙箱服务
pnpm install
pnpm build && pnpm check && pnpm test && pnpm lint
```

## 参与贡献

我们在开放中构建。欢迎贡献 —— 详见 [CONTRIBUTING.md](CONTRIBUTING.md)（即将推出）。

## 许可

[MIT](LICENSE)
