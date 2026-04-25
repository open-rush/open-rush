# Agent-0-relay 进度(M1 收尾)

接 agent-0-foundation,只管 task-5 + task-6。

## task-5 Unified auth middleware

- **状态**: ✅ 完成,等待合并
- **分支**: `feat/task-5`
- **文件域**: `apps/web/lib/auth/unified-auth.ts`(新)、`apps/web/lib/auth/unified-auth.test.ts`(新)
- **关键决策**:
  - 本地不 re-export `AuthContext`。`AuthScope` / `ServiceTokenScope` 从 `@open-rush/contracts`
    的 `v1` 命名空间别名引入(`import type { v1 } from '@open-rush/contracts'`),
    避免根 barrel 冲突(根 barrel 的具名 `AuthScope` 不存在,只有 v1 namespace 导出)。
  - Service Token 路径先判断 `Authorization: Bearer sk_` 前缀;否则回落 session,
    这样"Bearer 其它形式"(未来可能的新 scheme)不影响当前双轨语义。
  - `last_used_at` 更新用 Drizzle 的 `.execute()` promise,**不 await**,并附 `.catch(() => {})`
    吞掉 rejection,避免 DB 写入波动影响已完成的认证响应(spec §验证流程 伪代码一致)。
    `sql\`now()\`` 直接走 DB 当前时间,和 spec 一致。
  - 不在任何地方 `console.log` 原始 header / 明文 token。只在内存中哈希后查询,
    测试里还专门断言 "SQL 查询里传的是 hash 不是 plaintext"。
  - `hasScope(ctx, required)` 仅接受 `ServiceTokenScope`(不含 `'*'`)作为 required,
    防止调用方意外要求 `'*'`(`'*'` 是 runtime 结果,不该做 required 入参)。
- **测试覆盖**(14 个用例,全在 `unified-auth.test.ts`):
  - session happy path + wildcard scope
  - Authorization 非 `Bearer sk_` → 回落 session
  - service-token happy path + scopes 原样传回 + SQL 用 hash(plaintext 不泄漏)
  - last_used_at 异步更新不阻塞 authenticate() 返回(microtask 观察)
  - last_used_at update reject 不抛出
  - token 不存在 → null
  - revoked token → null + SQL 含 `isNull(revoked_at)`
  - expired token → null + SQL 含 `gt(expires_at, now)` 或 `isNull(expires_at)` 分支
  - 无 Authorization + 无 session → null
  - session 无 user.id → null
  - hasScope session `*` 通配任何 scope
  - hasScope service-token 显式匹配
  - hasScope service-token 不匹配 → false
  - hasScope empty scopes → 全拒
- **Lint 坑**:
  - biome 的 `useOptionalChain`:`header && header.startsWith(...)` 必须写 `header?.startsWith(...)`
  - biome 的 `noArrayForEach`:`.forEach(visit)` 在函数内要改 `for..of`
  - biome 的 organizeImports 对 `type` + 值混合 import 有特殊排序(`import { type X, y }` 不是 `import { y, type X }`),
    让 biome `--write` 自动修
  - `createHash from 'node:crypto'` 要在 workspace imports 之前
- **验证结果**:`pnpm build/check/lint/test` 全绿;`./docs/execution/verify.sh task-5` PASS(149 个 web 测试,含新增 14 个)。

## task-6 API /api/v1/auth/tokens CRUD

- **状态**: 待启动(task-5 merge 后开工)

---

## 注意事项(继承 agent-0)

- Sparring 铁律:commit 前必须 APPROVE
- 受保护文件 check:`.claude/plans/managed-agents-p0-p1.md` / `specs/*` / `docs/execution/verify.sh` / `docs/execution/TASKS.md`(只勾 checkbox)
- lint-staged 改文件要 `git add -A` 再 commit 一次
- 不 `--no-verify`
