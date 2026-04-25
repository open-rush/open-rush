# Service Token Authentication Spec

`/api/v1/*` 的机器对机器鉴权机制。与 Web UI 的 NextAuth session 并存于同一 endpoint(双轨鉴权)。

## 设计原则

- **双轨统一**: 同一 `/api/v1/*` endpoint 接受两种 auth,由请求特征自动识别
- **机器对机器**: Service Token 为外部程序(CLI / SDK / rush-app / 第三方)准备,不在浏览器持有
- **Hash 存储**: DB 只存 SHA256 hash,明文 token 仅创建时返回一次
- **Scope 显式**: Service Token 必须显式声明权限(principle of least privilege)
- **可吊销**: 软删除(revoked_at),不物理删除,便于审计

## 数据模型

```sql
CREATE TABLE service_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
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

## Token 格式

- 明文: `sk_<base64url(32 bytes)>`,例如 `sk_h4X2Zp...`
- 存储: `token_hash = sha256(明文)` 存 `token_hash` 字段
- 生成: `crypto.randomBytes(32).toString('base64url')` 加前缀

## 颁发流程

**前置**: 用户已通过 NextAuth 登录 Web UI(只有 session 用户可创建 token;拒绝"用 service token 再颁发 service token")。

```
POST /api/v1/auth/tokens
Cookie: <next-auth.session-token>
Content-Type: application/json

{
  "name": "my-cli-token",
  "scopes": ["agents:read", "agents:write", "runs:read", "runs:write"],
  "expiresAt": "2026-07-01T00:00:00Z"   // 必传,最长 90 天
}
```

**v0.1 护栏**(P0 必须实施):
- `scopes` 不能包含 `*`,否则 400 `VALIDATION_ERROR`
- `expiresAt` **必传**,且 `<= now() + 90 days`,否则 400
- 同一 userId 同时存活 token 上限 20 个(超限 400,提示吊销旧 token)
- 颁发时记录审计(userId, tokenId, scopes, ip, ua),未来对接 Audit API

**流程**:
1. 校验 NextAuth session,未登录 → 401
2. 生成 raw token,计算 hash
3. 写入 `service_tokens` 表
4. 响应 201,**只此一次返回明文 token**:
```json
{
  "data": {
    "id": "uuid",
    "token": "sk_h4X2Zp...",
    "name": "my-cli-token",
    "scopes": ["agents:read", ...],
    "createdAt": "...",
    "expiresAt": "2027-01-01T00:00:00Z"
  }
}
```

后续 `GET /api/v1/auth/tokens` 不返回 `token` 字段。

## 验证流程

### 中间件伪代码

```typescript
// apps/web/lib/auth/unified-auth.ts

export type AuthContext = {
  userId: string;
  scopes: string[];       // ['*'] for session, 显式 list for service token
  authType: 'session' | 'service-token';
};

export async function authenticate(req: Request): Promise<AuthContext | null> {
  const authHeader = req.headers.get('authorization');

  // Path 1: Service Token
  if (authHeader?.startsWith('Bearer sk_')) {
    const rawToken = authHeader.slice(7);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const token = await db.query.serviceTokens.findFirst({
      where: and(
        eq(serviceTokens.tokenHash, tokenHash),
        isNull(serviceTokens.revokedAt),
        or(
          isNull(serviceTokens.expiresAt),
          gt(serviceTokens.expiresAt, new Date())
        )
      )
    });

    if (!token) return null;

    // 异步更新 lastUsedAt,不阻塞请求
    db.update(serviceTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(serviceTokens.id, token.id))
      .execute();

    return {
      userId: token.ownerUserId,
      scopes: token.scopes as string[],
      authType: 'service-token'
    };
  }

  // Path 2: NextAuth Session
  const session = await getServerSession();
  if (session?.user?.id) {
    return {
      userId: session.user.id,
      scopes: ['*'],          // 立场 A: session 默认全权限
      authType: 'session'
    };
  }

  return null;
}

export function hasScope(ctx: AuthContext, required: string): boolean {
  return ctx.scopes.includes('*') || ctx.scopes.includes(required);
}
```

### Route handler 使用

```typescript
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return json({ error: { code: 'UNAUTHORIZED', ... } }, 401);
  if (!hasScope(auth, 'agents:write')) {
    return json({ error: { code: 'FORBIDDEN', ... } }, 403);
  }
  // ... 业务逻辑,使用 auth.userId 做资源归属校验
}
```

## Scope 定义(endpoint → scope 唯一矩阵)

每个 endpoint 对应**唯一** required scope,不重叠。

| Endpoint | Method | Required Scope |
|---|---|---|
| /api/v1/auth/tokens | POST / GET / DELETE | **session-only**(不接受 service token 自颁发) |
| /api/v1/agent-definitions | POST | `agent-definitions:write` |
| /api/v1/agent-definitions | GET | `agent-definitions:read` |
| /api/v1/agent-definitions/:id | GET | `agent-definitions:read` |
| /api/v1/agent-definitions/:id | PATCH | `agent-definitions:write` |
| /api/v1/agent-definitions/:id/versions | GET | `agent-definitions:read` |
| /api/v1/agent-definitions/:id/archive | POST | `agent-definitions:write` |
| /api/v1/agents | POST | `agents:write` |
| /api/v1/agents | GET | `agents:read` |
| /api/v1/agents/:id | GET | `agents:read` |
| /api/v1/agents/:id | DELETE | `agents:write` |
| /api/v1/agents/:id/runs | POST | `runs:write` |
| /api/v1/agents/:id/runs | GET | `runs:read` |
| /api/v1/agents/:id/runs/:runId | GET | `runs:read` |
| /api/v1/agents/:id/runs/:runId/events | GET(SSE) | `runs:read` |
| /api/v1/agents/:id/runs/:runId/cancel | POST | `runs:cancel` |
| /api/v1/vaults/entries | POST | `vaults:write` |
| /api/v1/vaults/entries | GET | `vaults:read` |
| /api/v1/vaults/entries/:id | DELETE | `vaults:write` |
| /api/v1/skills | GET | `agent-definitions:read` *(Registry 读权限复用)* |
| /api/v1/mcps | GET | `agent-definitions:read` *(同上)* |
| /api/v1/projects | POST | `projects:write` |
| /api/v1/projects | GET | `projects:read` |
| /api/v1/projects/:id | GET | `projects:read` |

**Scope 清单**(去除重叠):
- `agent-definitions:read` / `agent-definitions:write`
- `agents:read` / `agents:write`(Agent 层 CRUD,**不包含 Run 操作**)
- `runs:read` / `runs:write` / `runs:cancel`(Run 独立管理)
- `vaults:read` / `vaults:write`
- `projects:read` / `projects:write`
- `*`(仅 session 默认拥有;Service Token **禁止声明 `*`**,颁发时应拒绝)

**测试要求**(task-5 + task-6 + task-18 覆盖):
- 每个 endpoint 的 scope 校验都要单测断言
- 按本矩阵生成 scope 测试表,驱动 parametric test
- Service Token 创建 API 拒绝包含 `*` 的 scopes(返回 400)

## 资源归属校验

Scope 只控制"允许做这类操作",**资源归属是另一层检查**:

- AgentDefinition / Agent / Run / Vault 通过 `projectId` 归属
- 调用方的 `userId` 必须在该 project 的 `project_members` 内
- 不通过 → 403 `FORBIDDEN`

**Web UI session 同理**:即使 scopes=['*'],也只能访问自己是成员的 project。

## 吊销

```
DELETE /api/v1/auth/tokens/:id
```
- 设置 `revoked_at = now()`
- 已发出的 token 立即失效(下一次请求 401)
- 物理保留行便于审计

## 过期

- `expires_at` 非空且小于 now() → 视为失效
- 客户端收到 401 后应提示用户重新颁发

## 与 NextAuth Session 的差异

| 维度 | NextAuth Session | Service Token |
|---|---|---|
| 颁发者 | NextAuth(OAuth/Credentials)| 用户通过 `/api/v1/auth/tokens` |
| 存储 | sessions 表(NextAuth 管) | service_tokens 表 |
| 传输 | cookie | `Authorization: Bearer sk_*` |
| 默认 scope | `['*']`(立场 A) | 创建时显式声明 |
| 有效期 | NextAuth 策略(通常 30d)| 必传 `expiresAt`,最长 90 天 |
| 吊销 | NextAuth 登出 | `DELETE /api/v1/auth/tokens/:id` |
| 典型使用者 | 浏览器用户 | CLI / SDK / rush-app / 第三方 |

## 安全考虑

- **v0.1 不实施限流**:`RATE_LIMITED` 错误码为预留,P2 加
- **速率限制**(P2): Service Token 失败 5 次 / 分钟 → 临时封锁 token
- **日志**: 每次鉴权记录 `userId, tokenId(if svc), authType, ip, path`(审计需要,对应 P2 Audit API)
- **明文不入日志**: `authHeader` 全字段不进 log
- **CORS**: Service Token 请求不需要 CORS(API-first),Web UI 同源无需 CORS
- **HTTPS 强制**: 生产环境 Service Token 必须走 HTTPS,HTTP 拒绝

## 与 /api/* (非 v1) 的关系

`/api/auth/*`(NextAuth 路径)和 `/api/*` 非 v1 专属 route 只接受 Session,不走 `authenticate()` 的 Service Token 分支:

```typescript
// apps/web/lib/auth/session-only.ts
export async function requireSession(req: Request): Promise<Session | null> {
  const auth = await authenticate(req);
  if (auth?.authType !== 'session') return null;
  return auth as any;
}
```

实现上可复用 `authenticate()`,但拒绝 `authType === 'service-token'`。

## 未来演进(P2+)

- RBAC(立场 B)—— session 也按角色分 scope
- Token rotation(定期强制换)
- Per-project token(scope 限定到单个 project)
- 细粒度 scope(`agents:write:project:<uuid>`)
- Audit API 查询 token 使用历史
