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
