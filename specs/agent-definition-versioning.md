# AgentDefinition Versioning Spec

AgentDefinition(数据库层 `agents` 表)的不可变版本化设计。保证"一次需求 / 一次调用"(Agent 层)和"一次执行"(Run 层)绑定到特定版本快照,避免在运行中途 AgentDefinition 被改而产生难以追溯的行为变化。

## 设计原则

- **定义不可变**: 每次 PATCH 产生新 version,旧 version 不可改
- **快照绑定**: Agent 创建时快照 definition version,整个 Agent 生命周期使用该快照
- **乐观并发**: PATCH 必须带 `If-Match: <current_version>`,避免并发写冲突
- **历史完整**: 从 v1 开始保留所有 snapshot,支持审计和复现
- **零停机改动**: 改 definition 不打断正在跑的 Agent

## 数据模型

### `agents` 表(AgentDefinition 层)新增字段

```sql
ALTER TABLE agents
  ADD COLUMN current_version integer NOT NULL DEFAULT 1,
  ADD COLUMN archived_at timestamptz;
```

`current_version` 始终指向最新版本号(单调递增,从 1 开始)。

### `agent_definition_versions` 表(新增)

```sql
CREATE TABLE agent_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
CREATE INDEX agent_definition_versions_agent_idx
  ON agent_definition_versions(agent_id, version DESC);
```

`snapshot` 存储该版本完整 definition 字段(除 id/created_at/updated_at)。

### `tasks` 表新增字段(Agent 层绑定版本)

```sql
ALTER TABLE tasks
  ADD COLUMN definition_version integer;
```

创建 Agent(tasks 行)时必须固化一个 `definition_version`(默认 `agents.current_version`,也可显式指定)。整个 Agent 生命周期所有 Run 都继承这个版本。

**一致性约束**(应用层强校验,DB 不落组合外键避免跨表约束复杂度):
- 写入 `tasks.definition_version` 时,必须校验 `(task.agentId, value)` 在 `agent_definition_versions (agent_id, version)` 中存在。
- 服务层 `AgentService.create()` 在事务内完成:加载 version → 插入 tasks。
- 迁移期:对现有 tasks(definition_version 为 NULL)回填 `agents.current_version`(即 `1`)。

### `runs` 表新增字段(Run 层继承版本)

```sql
ALTER TABLE runs
  ADD COLUMN agent_definition_version integer;
```

`runs.agent_definition_version` 由创建时从 `tasks.definition_version` 复制而来(单一真相来自 tasks,runs 上冗余一份方便查询和避免多余 JOIN)。后续 worker 加载 snapshot 使用此值。

## API 语义

### 创建(POST)
- 首次创建即为 `v1`
- 同时插入 `agents` 行(current_version=1) + `agent_definition_versions` 行
- 事务内完成,失败整体回滚

### 更新(PATCH with If-Match)

```
PATCH /api/v1/agent-definitions/:id
If-Match: 2
Content-Type: application/json

{
  "systemPrompt": "新 prompt",
  "changeNote": "调整系统提示以支持 X"
}
```

**流程**:
1. 读 `agents.current_version`
2. 校验 `If-Match == current_version`,不匹配 → 409 `VERSION_CONFLICT`
3. 合并当前字段 + body 得到新状态
4. 插入新 `agent_definition_versions` 行(version = current + 1, snapshot = 新状态)
5. 更新 `agents` 表对应字段 + `current_version = current + 1`
6. 全部在同一 transaction 内
7. 返回新版本(`current_version`)

**幂等与并发**:
- 两个客户端同时读 v3 并 PATCH → 只有一个成功,另一个 409
- 客户端应捕获 409 后 refetch 最新版本,再决定是否重试

### 读取(GET)
- `GET /api/v1/agent-definitions/:id` → 返回 `agents` 表当前字段(= 最新 version)
- `GET /api/v1/agent-definitions/:id?version=N` → 从 `agent_definition_versions` 查 snapshot 返回
- `GET /api/v1/agent-definitions/:id/versions` → 列出 `{ version, changeNote, createdBy, createdAt }`(不含 snapshot 全文,减小 payload)

### 归档(POST /archive)
- 设置 `archived_at = now()`
- 归档后不允许 PATCH(返回 400)
- 归档后仍可创建 Agent(兼容历史需求),但会有 warning(未来可改为禁止)
- 归档可撤销(未来 P2)

## Agent 创建时的版本绑定

```
POST /api/v1/agents
{
  "definitionId": "uuid",
  "definitionVersion": 3,    // 可选,不传用 current_version
  "mode": "chat",
  "projectId": "uuid"
}
```

**流程**(事务内):
1. 加载 `agents` 行 + 校验 `definitionVersion`(或 `current_version`)在 `agent_definition_versions` 存在
2. 创建 `tasks` 行,`definition_version = <目标版本>`
3. 返回 Agent

**Run 派生**(`POST /agents/:id/runs` 或 task 模式首次 run):
1. 读 `tasks.definition_version`
2. 插入 `runs` 行,`agent_definition_version = tasks.definition_version`(不能为 NULL)
3. agent-worker 执行时按 `runs.agent_definition_version` 从 `agent_definition_versions` 加载 snapshot

**例外**: 不传 `definitionVersion` → 使用 `current_version`,并将该值冻结到 `tasks.definition_version`。

## 与 Agent / Run 生命周期的关系

```
AgentDefinition v2
  │
  │ POST /agents (definitionVersion=2)
  ▼
Agent (tasks.definitionVersion=2)
  │
  │ POST /runs (continues)
  ▼
Run (runs.agent_definition_version=2)
  │
  │ agent-worker 执行时加载 v2 snapshot
  ▼
Event stream...
```

AgentDefinition 在 Run 执行期间被 PATCH 到 v3,**正在跑的 Run 仍用 v2 snapshot**。新 Agent 创建时默认用最新 v3。

## 初次 migration

### agents 表

```sql
-- 列已默认 current_version = 1,已有行继承默认值
-- 为每个 agent 生成 v1 snapshot(snake_case 列名,排除运行态)
INSERT INTO agent_definition_versions (agent_id, version, snapshot, created_at)
SELECT
  id,
  1,
  to_jsonb(agents.*)
    - 'id' - 'created_at' - 'updated_at'
    - 'last_active_at' - 'active_stream_id' - 'current_version' - 'archived_at',
  created_at
FROM agents;
```

**snapshot 排除字段说明**:
- `id`、`created_at`、`updated_at`: 元数据,版本表自己有
- `last_active_at`、`active_stream_id`: 运行态,不属于定义
- `current_version`: 版本指针,snapshot 内不存
- `archived_at`: 归档状态,不属于定义

### tasks 表

```sql
ALTER TABLE tasks ADD COLUMN definition_version integer;

-- 回填现有 tasks 的 definition_version = 1(所有存量 agents 初始 v1)
UPDATE tasks
SET definition_version = 1
WHERE agent_id IS NOT NULL AND definition_version IS NULL;

-- 回填完成后,后续应用层保证新写入不为 NULL(当前不加 NOT NULL 约束,
-- 因为 tasks.agent_id 允许 set null,与 definition_version 的强绑定关系
-- 由应用层保证)
```

### runs 表

```sql
ALTER TABLE runs
  ADD COLUMN agent_definition_version integer,
  ADD COLUMN idempotency_key varchar(255);

-- runs 表回填:从 tasks 级联(对已有 runs)
UPDATE runs
SET agent_definition_version = t.definition_version
FROM tasks t
WHERE runs.task_id = t.id AND runs.agent_definition_version IS NULL;

-- 对无 task_id 的历史 run(极少),回填为 agents.current_version
UPDATE runs
SET agent_definition_version = a.current_version
FROM agents a
WHERE runs.agent_id = a.id AND runs.agent_definition_version IS NULL;
```

## 未来演进(P2+)

- 版本压缩 / 归档历史(避免膨胀)
- 回滚到历史版本(创建新 version 复制旧 snapshot 内容)
- Diff 视图(API 层面可比较两个版本)
- 分支 / 标签(tag 某个 version 为 "stable")

## 不做

- 不做 Git 风格的合并 / rebase(复杂度过高)
- 不支持跳版本(version 必须单调递增 +1)
- 不做软删除 snapshot(一旦创建永久保留,archive definition 不影响 snapshot 存储)
