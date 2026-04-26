# agent-c-docs-fe — progress

## task-17: README v2 + quickstart + api docs ✅ (PR #155 merged, follow-up #156 merged)

Shipped. Notes archived.

## task-19 Step 1: Frontend migration to /api/v1/* (legacy kept)

### Decisions

- **Branch**: `feat/task-19-step1` from main (`3cad0a9`, includes task-17 + task-18 merges).
- **Scope**: migrate frontend fetch calls that have a direct, semantically equivalent v1 endpoint AND don't require UI form changes (e.g. adding `providerType` / `model` fields). Keep legacy routes in tree for Step 2 to delete.
- **Not touched in Step 1**:
  - `POST /api/agents` / `PATCH /api/agents/:id` (needs form fields `providerType` + `model`; `TODO(task-19 Step 2)` comments added at call sites).
  - `POST /api/chat/start` (home page 1-step create-project+task+conversation; no 1:1 v1 equivalent — v1 requires already-known `projectId` + `definitionId`).
  - `GET /api/chat/:id/messages`, `POST /api/chat/:id/generate-title` (UI-only per spec §与 Web UI 关系; stay on legacy even in Step 2).
  - `GET /api/conversations` / `GET /api/conversations/:id` (UI-only; stay on legacy even in Step 2).
  - `/api/projects/*`, `/api/skills/*`, `/api/mcps/*`, `/api/skill-groups/*` (no v1 equivalents merged; not blocked by verify.sh Step-4 grep).

### Migrated call sites (Step 1)

| File | Legacy call | v1 call | Notes |
| --- | --- | --- | --- |
| `apps/web/app/(app)/chat/[id]/page.tsx` | `fetch('/api/agents/:id')` (provider label) | `GET /api/v1/agent-definitions/:id` | envelope `{ data }` |
| same | `fetch('/api/runs/:id/stream')` | `GET /api/v1/agents/:taskId/runs/:runId/events` | SSE, `Last-Event-ID` |
| same | `fetch('/api/runs')` POST | `POST /api/v1/agents/:taskId/runs` | Added `Idempotency-Key: uuidv4` header; dropped 409+activeRunId branch (v1 allows concurrent runs, no longer needed) |
| same | `fetch('/api/runs/:id/abort')` | `POST /api/v1/agents/:taskId/runs/:runId/cancel` | - |
| same | `fetch('/api/tasks/:id')` | `GET /api/v1/agents/:id` | task = v1 Agent |
| same | `fetch('/api/runs/:id')` | `GET /api/v1/agents/:taskId/runs/:runId` | - |
| `apps/web/app/(app)/page.tsx` | `fetch('/api/agents?projectId=X')` | `GET /api/v1/agent-definitions?projectId=X&limit=200` | envelope now paginated |
| `apps/web/components/agents/agent-studio-client.tsx` | `fetch('/api/agents?projectId=X')` | same as above | - |
| `apps/web/components/agents/project-agent-manager.tsx` | `fetch('/api/agents?projectId=X')` | same as above | - |

### Legacy fetches **deliberately retained** (Step 2 / follow-up must address)

- `POST /api/chat/start` — 1 call site (home page). Needs refactor in UI: first call something to ensure project+AgentDefinition exist, then `POST /api/v1/agents` with `initialInput`.
- `POST|PATCH /api/agents` — 2 call sites. Blocker: form lacks `providerType` + `model`. Options: (a) add form fields; (b) hardcode `providerType="claude-code"` + project default model.
- `DELETE /api/agents/:id` — 2 call sites (agent-studio, project-agent-manager). Sparring MUST-FIX kept this on legacy: v1 archive is pure "set archivedAt" but legacy DELETE also rebinds `projects.currentAgentId` to another active agent (apps/web/app/api/agents/[id]/route.ts:117-130). Step 2 must either extend v1 archive to do that rebind, or call `PUT /api/projects/:id/agent` with a replacement after archiving.
- `GET /api/conversations*`, `GET /api/chat/:id/messages`, `POST /api/chat/:id/generate-title` — UI-only, no v1 equivalent; intended to stay on `/api/*` per spec.
- `/api/projects/*`, `/api/skills/*`, `/api/mcps/*`, `/api/skill-groups/*` — no v1 equivalents merged; outside Step 1 grep-check scope.

### Helper added

- `apps/web/lib/api/v1-list.ts` — `fetchAllV1<T>()` follows `nextCursor` to completion with maxPages guardrail. Used by home page + agent-studio + project-agent-manager list fetches. Unbounded-list parity with legacy avoided the Sparring SHOULD-FIX of silently truncating at 200.

### Verification (local)

- `pnpm build` ✅ (cached full turbo after initial build passed)
- `pnpm check` ✅ (TypeScript strict)
- `pnpm lint` ✅ (3 pre-existing warnings + 2 infos, 0 errors — baseline unchanged)
- `pnpm test` ✅ (410 tests pass including E2E 13 scenarios)

### Not run (per Step 1 scope)

- `verify.sh task-19` — will fail legacy-route-exists checks by design; Step 2 is when it must pass.
- Manual regression (login / create Agent / SSE / cancel) — blocked by local DB not being up; legacy routes still handle the flows so runtime unchanged. Will do after merge or via Step 2 PR validation.

### Sparring

Running via Codex next.

### Files touched

- `apps/web/app/(app)/chat/[id]/page.tsx` — 5 fetch call sites rewritten; `startRun` 409+activeRunId branch removed; useCallback deps trimmed.
- `apps/web/app/(app)/page.tsx` — 1 fetch migrated; error envelope adjusted.
- `apps/web/components/agents/agent-studio-client.tsx` — 2 fetches migrated + 1 TODO added for POST/PATCH.
- `apps/web/components/agents/project-agent-manager.tsx` — 2 fetches migrated + 1 TODO for handleSave.
- `docs/execution/current_tasks/task-19.lock` — created, will remove before commit.
- `docs/execution/progress/agent-c-docs-fe.md` — this file.

---

## task-19 Step 2 handoff (for agent-c-docs-fe-relay or similar)

**Goal**: delete legacy routes listed in `docs/execution/verify.sh` §task-19 `LEGACY_TO_REMOVE`, close verify.sh task-19 gate, flip TASKS.md checkbox, close issue #134.

**Current branch baseline for Step 2**: start a new branch `feat/task-19-step2` off `origin/main` **after PR #159 merges**. Do NOT continue on `feat/task-19-step1`.

### Step 2 blockers (4) — each one needs a decision before deleting legacy

#### B1. DELETE /api/agents/:id rebind regression

- **Symptom if ignored**: legacy DELETE at `apps/web/app/api/agents/[id]/route.ts:117-130` does: (a) set `projectAgents.isCurrent = false` for the removed agent, (b) pick any active agent in the project and call `projectAgentService.setCurrentAgent(projectId, replacement.id)`. v1 `POST /api/v1/agent-definitions/:id/archive` (`packages/control-plane/src/agent-definition-service.ts:archive()`) sets only `archivedAt`. Naively migrating would leave `projectAgents` with `isCurrent=true` pointing at the archived row; UI's `GET /api/projects/:id/agent` would return an archived definition and the "current agent" field would display a broken reference.
- **Team-lead preferred solution**: **Option B (frontend-side)** — after the archive call, UI runs:
  1. Check if `archivedId === currentBinding.agentId` (data already in scope in `agent-studio-client.tsx` and `project-agent-manager.tsx`).
  2. If yes, compute `nextActiveId = agents.find(a => a.id !== archivedId && !a.archivedAt)?.id ?? null`.
  3. If `nextActiveId`, call `PUT /api/projects/:projectId/agent { agentId: nextActiveId }`; if null, call `PUT /api/projects/:projectId/agent { agentId: null }` (need to confirm the legacy handler accepts null — check `apps/web/app/api/projects/[id]/agent/route.ts`).
- **Alternative (Option A)**: extend v1 `archive` service to accept `{ rebindProject: boolean }`. Touches `packages/contracts/src/v1/agent-definitions.ts` + `packages/control-plane/src/agent-definition-service.ts` + `apps/web/app/api/v1/agent-definitions/[id]/archive/route.ts`. More work, more Sparring, but cleanly encapsulates.
- Callers affected (keep TODO comments in sync):
  - `apps/web/components/agents/agent-studio-client.tsx` (handleDelete)
  - `apps/web/components/agents/project-agent-manager.tsx` (handleDelete)

#### B2. POST|PATCH /api/agents — form missing `providerType` + `model`

- **Symptom if ignored**: v1 `createAgentDefinitionRequestSchema` requires `providerType: string.min(1)` and the DB stores it non-null; the legacy `CreateAgentRequest` (`packages/contracts/src/agent.ts`) has neither field. Migrating naively gives 400 VALIDATION_ERROR.
- **Callers**: `apps/web/components/agents/agent-studio-client.tsx` handleSave; `apps/web/components/agents/project-agent-manager.tsx` handleSave.
- **Three options** (team-lead prefers (c) = defer):
  - (a) Add form fields for `providerType` (enum? free text?) + `model`. UX decision needed.
  - (b) Hardcode `providerType='claude-code'` and pick `model` from project default. Leaks abstraction into UI but unblocks migration.
  - (c) Do not migrate POST/PATCH in Step 2 either — **keep legacy `POST /api/agents` + `PATCH /api/agents/:id` as UI-private routes** (i.e. remove them from `verify.sh LEGACY_TO_REMOVE` and add to the KEEP list, since `POST /api/agents/:id` per spec §与 Web UI 关系 is UI-only when Service Token can't call it). This requires editing `docs/execution/verify.sh` (normally protected — will need approval) and updating plan §8 task-19.
- **Recommendation**: bring to team-lead for decision at start of Step 2.

#### B3. POST /api/chat/start — no v1 equivalent

- **What it does** (read `apps/web/app/api/chat/start/route.ts`): (1) ensure a default project exists (create if missing), (2) resolve an `agentId` for the project via `resolveAgentIdForProject`, (3) create `tasks` row + `conversations` row in a transaction, (4) return `{ projectId, taskId, conversationId }`.
- **Called from**: `apps/web/app/(app)/page.tsx` home page.
- **v1 equivalent**: none directly. Closest mapping is a 3-call sequence:
  1. Ensure project exists — **no v1 POST /api/v1/projects exists yet**; `packages/contracts/src/v1/projects.ts` defines the schema but no route file. Step 2 would need to add `apps/web/app/api/v1/projects/route.ts` (POST + GET), plus `apps/web/app/api/v1/projects/default/route.ts` or equivalent resolution helper.
  2. Resolve or create default AgentDefinition — needs `GET /api/v1/agent-definitions?projectId=X&limit=1` (already works). If none, the home page can't continue — probably throw a helpful error + direct user to `/studio`.
  3. `POST /api/v1/agents { projectId, definitionId, mode: "chat", initialInput: text }` — v1 already supports this and returns `{ agent, firstRunId }`. home page can then redirect to `/chat/<conversationId>?taskId=<agent.id>`… except **v1 doesn't create a `conversations` row**. That's a UI-only concept.
- **Recommendation**: Step 2 either (a) adds `POST /api/v1/projects` + keep `/api/chat/start` as UI-only behind session (then it's not in `LEGACY_TO_REMOVE`), or (b) does a full UX refactor where the home page has a "pick a project + AgentDefinition" explicit step. (a) is faster; the conversation row can be created via legacy `POST /api/conversations` or a new UI-private endpoint.

#### B4. GET /api/conversations* — no v1 equivalent

- **Callers**: `components/layout/sidebar.tsx` (list by project), `app/(app)/conversations/[id]/page.tsx` (detail), also referenced indirectly via `/api/chat/start` creating conversation rows.
- **Fix**: add `GET /api/v1/conversations?projectId=...` + `GET /api/v1/conversations/:id`, OR remove these endpoints from `LEGACY_TO_REMOVE` and mark them as UI-private per spec §与 Web UI 关系. Per spec they clearly belong to the UI-only set (conversation is a UI concept, not API).
- **Recommendation**: argue for removing from `LEGACY_TO_REMOVE` (update `docs/execution/verify.sh` + plan §8 task-19). Need team-lead sign-off because verify.sh is protected.

### `verify.sh task-19` `LEGACY_TO_REMOVE` list (reference)

```
apps/web/app/api/tasks                        # all fetches migrated; safe to delete
apps/web/app/api/runs                         # all fetches migrated; safe to delete (incl. [id]/stream, [id]/abort, [id])
apps/web/app/api/chat/route.ts                # no frontend caller; safe to delete
apps/web/app/api/chat/start                   # B3 — blocker
apps/web/app/api/chat/abort                   # no frontend caller; safe to delete
apps/web/app/api/conversations                # B4 — blocker (UI-only)
apps/web/app/api/agents/route.ts              # B2 blocker (POST); GET already migrated
apps/web/app/api/agents/[id]/route.ts         # B1 + B2 blockers
apps/web/app/api/skills/route.ts              # no v1 equivalent; need v1/skills route OR mark UI-only
apps/web/app/api/skills/[id]/route.ts         # same
apps/web/app/api/skills/upload                # UI-private per spec; argue for KEEP list
apps/web/app/api/mcps/route.ts                # no v1 equivalent; need v1/mcps route OR mark UI-only
apps/web/app/api/mcps/[id]/route.ts           # same
apps/web/app/api/projects/route.ts            # need POST/GET v1/projects (B3 overlap)
apps/web/app/api/projects/[id]/route.ts       # need GET v1/projects/:id
apps/web/app/api/projects/[id]/vault          # v1/vaults exists; just migrate the caller then delete
```

Four blockers (B1-B4) + ~7 routes that either need a new v1 endpoint or need to move to the KEEP list. Expect Step 2 to require at least one plan/spec conversation with team-lead.

### `verify.sh` KEEP list to argue for expanding

Per spec §与 Web UI 关系 the following are legitimately UI-only and should NOT be deleted — argue to move them from `LEGACY_TO_REMOVE` to KEEP:

- `/api/chat/start`, `/api/chat/abort` (UI 1-step create / stop; API callers use v1 agents+runs directly)
- `/api/chat/[id]/messages`, `/api/chat/[id]/generate-title` (already KEEP per spec; grep in verify.sh Step 4 currently catches them — need to tighten grep to exclude `/api/chat/*/messages` and `/api/chat/*/generate-title`)
- `/api/conversations` + `/api/conversations/[id]` (UI-only data shape)
- `/api/skills/upload`, `/api/skills/[id]/star`, `/api/skills/[id]/members` (UI-private)
- `/api/mcps/[id]/install`, `/api/mcps/[id]/members`, `/api/mcps/[id]/star`
- `/api/projects/[id]/agent`, `/api/projects/[id]/members/*`, `/api/projects/[id]/skills/*`, `/api/projects/[id]/mcp/*`, `/api/projects/[id]/memory`, `/api/projects/[id]/vault` (UI-only project admin)

### Step 2 manual regression checklist

After Step 2 is coded, verify these 6 flows against a real dev server (`pnpm db:up && pnpm dev`, browser at :3000):

1. **Login** — GitHub OAuth round-trip; `/api/auth/callback/github` handles it (KEEP).
2. **Home page — list agents** — verify the agent cards render and `projectName` shows the right project. Network tab should show `GET /api/v1/agent-definitions?projectId=…&limit=100` with `{ data, nextCursor }` envelope.
3. **Create AgentDefinition** (via /studio) — POST success. If B2 (a)/(b) chosen, verify `providerType` makes it to DB and subsequent list shows the new row.
4. **Start a chat + see SSE** — click an agent card on home, type a prompt, hit Enter. Network tab should show `POST /api/v1/agents/:taskId/runs` (with `Idempotency-Key` header) then `GET /api/v1/agents/:taskId/runs/:runId/events` (SSE). Verify text-delta chunks arrive and the assistant bubble fills.
5. **Cancel a running run** — click stop. Network tab should show `POST /api/v1/agents/:taskId/runs/:runId/cancel`; the SSE connection should close; run status should become `cancelled` (check via `GET /api/v1/agents/:taskId/runs/:runId`).
6. **Archive an AgentDefinition** (from /studio) — verify: (a) the agent disappears from the list, (b) if it was the current one, the project default binding rebinds to another active agent (if B1 Option B chosen, watch for the `PUT /api/projects/:projectId/agent` follow-up call in Network tab), (c) re-entering /studio still lists the other agents correctly.

Record "✓ 6/6" in a new progress section; screenshots only if a step fails.

### Key risks Step 2 author should hold

1. **Every legacy route deletion must be preceded by a full grep of `apps/web/{app,components,hooks,lib}` for `fetch('…')` callers**. If you miss one, production breaks silently.
2. **Don't modify `verify.sh` `LEGACY_TO_REMOVE` / KEEP without team-lead approval** — that file is protected per AGENTS.md.
3. **v1 archive rebind behavior is new surface** (B1). Add unit tests for the rebind path (mocked `projectAgentService`) before deleting legacy DELETE.
4. **B3 home-page refactor may touch first-user UX** — test with a brand-new account that has zero projects.
5. **API-layer "Agent" = DB `tasks`, "AgentDefinition" = DB `agents`**. Easy to confuse. Keep this note visible (see `specs/managed-agents-api.md §四层概念栈`).

### Files to read first on a new relay session

1. This file — `docs/execution/progress/agent-c-docs-fe.md`.
2. `docs/execution/verify.sh` — full task-19 case block.
3. `.claude/plans/managed-agents-p0-p1.md` §8 task-19 + §10 发布策略.
4. `specs/managed-agents-api.md` §与 Web UI 关系 (defines the UI-private set).
5. PR #159 description + final merge commit — full context of Step 1.
6. `apps/web/app/api/agents/[id]/route.ts` (legacy DELETE rebind) + `packages/control-plane/src/agent-definition-service.ts` (v1 archive impl).
