# Rush

完整开发指南见 [AGENTS.md](./AGENTS.md)。以下是快速参考。

## 铁律

**所有方案、代码变更、Spec 变更必须经过 Sparring Review（双 Agent 交叉审查），无任何例外。**

## 提交前门禁（5 步）

```
1. pnpm build        — 构建通过
2. pnpm check        — 类型检查通过
3. pnpm lint         — lint 通过
4. pnpm test         — 测试通过
5. Sparring review   — APPROVE 或无 MUST-FIX
```

## 变更流程

- **Small**：改代码 → 门禁 → **Sparring** → 提交
- **Medium**：读 Spec → 代码+测试 → 更新 Spec → 门禁 → **Sparring** → 提交
- **Large**：写 Plan → **Sparring Plan** → 写 Spec（如需）→ **Sparring Spec** → 实现+测试 → 门禁 → **Sparring 代码** → 提交
- **Bug**：根因分析 → **Sparring 结论** → Red Test → 修复 → 门禁 → **Sparring 代码** → 提交

Plan = 实施方案（会话内，不入库）。Spec = 方向性设计决策（`specs/` 入库）——状态机、流程、协议、架构约束。

每个 commit 必须包含**代码 + 测试**。

## 架构

三层：`apps/web`（Next.js）→ `apps/control-worker`（pg-boss）→ `apps/agent-worker`（Hono，沙箱内）

## 快速命令

```bash
pnpm build && pnpm check && pnpm lint && pnpm test   # 门禁 1-4
pnpm dev                                               # 启动开发服务器
pnpm db:up                                             # 启动 PG + Redis
pnpm test:integration                                  # 集成测试（需 Docker）
```

## 约定

- TypeScript strict, ESM, 禁止 `any`
- Biome lint + format，Vitest 测试
- Packages: tsup 构建，`workspace:*` 引用
- 状态机: `packages/contracts/src/enums.ts`（15 状态 RunStatus）
- DB: `packages/db/src/schema/`（13 张表，Drizzle ORM）
