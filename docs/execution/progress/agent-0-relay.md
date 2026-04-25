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

- **状态**: ✅ 完成,等待合并
- **Worktree**: `/tmp/agent-wt/0-relay`(coordinator 在 task-5 merge 后建的专属 worktree,三 agent 各自隔离)
- **分支**: `feat/task-6`(基于 main `e6d943b`)
- **文件域**:
  - `apps/web/app/api/v1/auth/tokens/route.ts`(新,POST + GET)
  - `apps/web/app/api/v1/auth/tokens/[id]/route.ts`(新,DELETE)
  - `apps/web/lib/auth/service-token-service.ts`(新,token 生成 + 业务逻辑)
  - 3 个对应 `*.test.ts`
- **关键决策**:
  - **分层**:route 只做 auth 校验 + Zod parse + 错误映射,业务逻辑(生成、cap 护栏、pagination、revoke 语义)全部下沉到 `service-token-service.ts`。route 试错面更窄,service 可以在 task-18 补集成测试时直接复用。
  - **POST 护栏**:
    - session-only(service-token auth → 403 `FORBIDDEN`,拒绝自颁发)
    - contracts v1 `createTokenRequestSchema.safeParse` 已经拒绝 scopes 含 `*` / expiresAt 过去 / > 90 天(task-4 superRefine),route 不重复校验
    - service 层 `countActiveTokensForOwner` ≥ 20 → 抛 `TokenCapExceededError`,route 捕获 → 400 `VALIDATION_ERROR` + `hint: "revoke an existing token first"`
    - 只有 `createToken` 返回明文(仅此一处),route body 返回 `data.token`,201 created
  - **GET 护栏**:
    - session 或 service-token 都接受(一个 CLI token 可以列出同一 owner 的全部 tokens,方便 CLI 自检)
    - paginated_query_schema 用 `coerce.number`,route 把 searchParams 转 `{ limit, cursor }`
    - row shape 严格匹配 `tokenListItemSchema`:不包含 `token` 也不包含 `token_hash` 字段。测试用 `JSON.stringify` 断言这两个 key 不存在(防御性)。
  - **DELETE 护栏**:
    - 允许 session 和 service-token(和 GET 一致)
    - service 层返回 discriminated union:`{ kind: 'revoked' | 'not_found' | 'forbidden' }`,route 根据 kind 返回 200/404/403
    - 非 owner 直接 403(不泄漏 "id 存在但不属于你" 的信息,用 uniform 403 防枚举)
    - 幂等:已 `revoked_at` 的行再 DELETE 返回 200 + 原 `revokedAt`(不覆盖)
  - **Pagination cursor**:opaque base64url(JSON `{c, id}`)。多 fetch 一行判断是否有下一页(`hasMore`)。malformed cursor 静默忽略(不抛 400),避免给错误输入过多信息。
  - **Token 生成**:`sk_ + randomBytes(32).toString('base64url')`(≥ 46 chars,spec §Token 格式 对齐)。`createHash('sha256').update(raw).digest('hex')` 作 hash。明文仅出现在内存和 201 响应体,不写日志、不写 DB。
- **测试覆盖**(42 个用例):
  - service-token-service.test.ts(20 测试):
    - plaintext 格式 + 唯一性 + hash 正确性(2+1+1)
    - countActiveTokensForOwner 正常 / 0(2)
    - createToken:hash 存储(不存明文)+ cap 触发 + cap above(3)
    - encode/decode cursor:round-trip + garbage + 错结构(3)
    - listTokens:无 nextCursor + hasMore + 限长 clamp + 错误 cursor 宽容(4)
    - revokeToken:not_found / forbidden / idempotent / freshly revoked / race re-read(5)
  - route.test.ts(POST + GET, 15 测试):
    - 401 unauth, 403 service-token 自颁发, 400 invalid JSON / scopes '*' / expiresAt 过期 / expiresAt > 90 天 / cap 触发(带 hint), 201 happy + 明文, 400 name 空 / scopes 空
    - 401 GET unauth, lists 不含 token/hash 字段, service-token 允许, 400 bad query, cursor passthrough
  - \[id\]/route.test.ts(DELETE, 7 测试):
    - 401 unauth, 400 UUID 格式错, 404 不存在, 403 非 owner, 200 freshly revoked, 200 幂等, 200 service-token 身份
- **测试坑**:
  - `vi.mock` 是 hoisted 的,mock factory 里引用的外部 class / 函数必须用 `vi.hoisted(() => ({...}))` 包装,否则 "Cannot access X before initialization"(route.test.ts 踩过,已用 hoisted 解决)
  - Drizzle 的 `.select().from().where()` 在 `countActiveTokensForOwner` 里直接 await(没有 `.limit()`);mock 必须是 thenable(`then` 作 promise 的 entry point)。在测试文件顶端用 `biome-ignore-all lint/suspicious/noThenProperty` 抑制 biome 规则(biome 认为对象上出现 `then` 是反模式,这里是为了贴近真实 Drizzle 链)。
  - biome `useOptionalChain` 要求 `!updated?.revokedAt` 而不是 `!updated || !updated.revokedAt`
- **验证结果**:`pnpm build/check/lint/test` 全绿(32 task);`./docs/execution/verify.sh task-6` PASS(191 web 测试,含新增 42 个)。

---

## 注意事项(继承 agent-0)

- Sparring 铁律:commit 前必须 APPROVE
- 受保护文件 check:`.claude/plans/managed-agents-p0-p1.md` / `specs/*` / `docs/execution/verify.sh` / `docs/execution/TASKS.md`(只勾 checkbox)
- lint-staged 改文件要 `git add -A` 再 commit 一次
- 不 `--no-verify`
