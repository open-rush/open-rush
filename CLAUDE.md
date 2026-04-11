# Rush

完整开发指南见 [AGENTS.md](./AGENTS.md)。以下是快速参考。

## 快速命令

```bash
pnpm build && pnpm check && pnpm lint && pnpm test   # 提交前门禁
pnpm dev                                               # 启动开发服务器
pnpm db:up                                             # 启动 PG + Redis
pnpm test:integration                                  # 集成测试（需 Docker）
```

## 架构

三层：`apps/web`（Next.js）→ `apps/control-worker`（pg-boss）→ `apps/agent-worker`（Hono，沙箱内）

## 变更流程

- **Small**（无逻辑变更）：改代码 → check/lint/test → 提交
- **Medium**（有逻辑变更）：读 Spec → 代码+测试 → 更新 Spec → 提交
- **Large**（新模块/架构）：写 Spec → TDD → 代码+测试 → 提交

每个 commit 必须包含**代码 + 测试**。Spec 在 `specs/` 目录。

## 约定

- TypeScript strict, ESM, 禁止 `any`
- Biome lint + format，Vitest 测试
- Packages: tsup 构建，`workspace:*` 引用
- 状态机: `packages/contracts/src/enums.ts`（15 状态 RunStatus）
- DB: `packages/db/src/schema/`（13 张表，Drizzle ORM）
