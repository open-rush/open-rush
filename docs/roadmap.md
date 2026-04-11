# Open Rush v2 — Roadmap

## Vision

Enterprise AI agent infrastructure — self-hosted, multi-scenario, built for every team member.

Rush is a platform that enterprises deploy internally. Once deployed, developers use CLI and API to automate. Non-technical teams build apps, analyze data, and generate content through Web UI. All powered by sandboxed Claude Code agents running in the enterprise's own infrastructure.

### Full Picture

```
Entry Points                          Scenarios
├── Web UI    (everyone)              ├── Web app building
├── CLI       (developers)            ├── Code generation
├── API       (system integration)    ├── Data analysis
└── SDK       (embedded in products)  ├── Workflow automation
                                      ├── Document / report generation
                                      └── Multimodal tasks

Platform Layer (this repo)
├── Agent orchestration    — conversation, state machine, checkpoint
├── Sandbox isolation      — per-task containers, pluggable runtime
├── Skills & MCP           — plugin ecosystem
├── Memory                 — cross-session learning
├── Vault                  — dual-layer credential management
├── Multi-tenant           — per-user projects, RBAC
└── Observability          — OTEL + LLM cost tracking
```

### Current Scope (M0–M4)

The initial release focuses on: **platform layer + web app building scenario + Web UI entry point**. CLI, API, SDK, and additional scenarios are planned post-GA.

### Core Principles

- Zero proprietary dependencies — all standard open-source libraries
- Self-hosted — your data stays in your infrastructure
- Claude Code native — single agent runtime, three connection modes
- Pluggable sandbox — OpenSandbox default, bring your own
- Dual-layer Vault — platform credentials (admin) + user credentials (self-service)
- Test-driven — all tests written from scratch
- Spec-driven — features defined in `specs/` before implementation

---

## Repo Structure

```
open-rush/
├── apps/
│   ├── web/                    # Next.js 16 — User Portal + Control API
│   ├── control-worker/         # Background orchestration — pg-boss consumer, state machine
│   └── agent-worker/           # Hono — Agent execution inside sandbox container
│
├── packages/
│   ├── contracts/              # Zod schemas — zero deps, all type definitions
│   ├── db/                     # Drizzle ORM + PostgreSQL schema + migrations
│   ├── control-plane/          # Orchestration logic (RunService, AgentService, EventStore, FinalizationStateMachine)
│   ├── sandbox/                # SandboxProvider interface (pluggable) + built-in OpenSandboxProvider
│   ├── agent-runtime/          # AI Provider abstraction (Claude, Codex, Gemini, OpenAI)
│   ├── stream/                 # Redis-backed resumable SSE
│   ├── integrations/           # External integrations (GitHub, S3, OAuth)
│   ├── ai-components/          # React AI UI component library
│   ├── skills/                 # Skills runtime (install, discover, execute)
│   ├── mcp/                    # MCP server management (lifecycle, proxy, registry)
│   └── memory/                 # User memory system (embedding, search, personalization)
│
├── specs/
│   ├── architecture/           # System-level constraints and decisions
│   └── features/               # Per-feature behavior contracts
│
├── docker/                     # Dockerfile + compose (local dev)
├── docs/                       # Architecture docs
├── tests/
│   ├── e2e/                    # Playwright E2E tests
│   └── e2e/                    # Playwright E2E tests
├── AGENTS.md
├── CLAUDE.md
└── verify.sh
```

---

## Agent Runtime: Claude Code Only

No multi-provider abstraction. Claude Code CLI is the sole agent runtime, configured via environment variables.

### Three Connection Modes

| Mode | Env Vars | Use Case |
|------|----------|----------|
| **Anthropic API** | `ANTHROPIC_API_KEY` | Direct Anthropic API |
| **AWS Bedrock** | `CLAUDE_CODE_USE_BEDROCK=1` + AWS creds + `ANTHROPIC_MODEL=arn:...` | AWS Bedrock with ARN |
| **Custom endpoint** | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` | Compatible APIs (e.g. Zhipu GLM) |

All credentials are managed through Vault. The platform auto-detects connection mode and selects the injection strategy:

| Mode | Vault Type | Injection | Key in container? |
|------|-----------|-----------|-------------------|
| Anthropic API | `anthropic_api` | Vault → Credential Proxy | No |
| Custom endpoint | `custom_endpoint` | Vault → Credential Proxy | No |
| AWS Bedrock | `aws_bedrock` | Vault → env injection | Yes (SigV4 requires it) |

### Two Vault Scopes

| Scope | Managed by | Visible to user | Example |
|-------|-----------|-----------------|---------|
| **Platform Vault** | Admin / control plane | No | Bedrock keys, S3 access, internal service tokens |
| **User Vault** | End user | Yes | Personal GitHub token, custom API keys |

Runtime merge: Platform Vault loads first, User Vault overrides (same `injection_target` → user wins).

Users only interact with User Vault. Platform Vault and Credential Proxy are internal — invisible to users.

---

## Sandbox: OpenSandbox

### Architecture

The control plane manages containers through an external sandbox platform API — never touching Docker/K8s directly:

```
Control Worker → SandboxProvider interface → OpenSandboxProvider → OpenSandbox API → Container
```

### Interface Mapping

| SandboxProvider Method | OpenSandbox SDK Call |
|-----------------------|--------------------|
| `create(image, opts)` | `Sandbox.create({ image, env, networkPolicy, resource })` |
| `get(sandboxId)` | `Sandbox.connect({ sandboxId })` |
| `destroy(sandboxId)` | `sandbox.kill()` |
| `extendTTL(sandboxId, ttl)` | `sandbox.renew(timeoutSeconds)` |
| `exec(sandboxId, cmd)` | `sandbox.commands.run(cmd)` (SSE streaming) |
| `readFile(sandboxId, path)` | `sandbox.files.read(path)` |
| `writeFile(sandboxId, path, content)` | `sandbox.files.write(path, content)` |
| `resolveEndpoint(sandboxId, port)` | `sandbox.getEndpointUrl(port)` |
| — | `sandbox.pause()` / `sandbox.resume()` |
| — | `sandbox.patchEgressRules()` |

### Pluggable Provider Design

```typescript
interface SandboxProvider {
  create(opts: CreateSandboxOpts): Promise<SandboxInfo>;
  get(sandboxId: string): Promise<SandboxInfo>;
  destroy(sandboxId: string): Promise<void>;
  extendTTL(sandboxId: string, ttlSeconds: number): Promise<void>;
  exec(sandboxId: string, command: string): Promise<ExecResult>;
  readFile(sandboxId: string, path: string): Promise<Buffer>;
  writeFile(sandboxId: string, path: string, content: Buffer): Promise<void>;
  listPath(sandboxId: string, path: string): Promise<FileInfo[]>;
  resolveEndpoint(sandboxId: string, port: number): Promise<string>;
}

// Built-in: OpenSandboxProvider (default)
// Community: E2BSandboxProvider, DockerSandboxProvider, FlyMachineProvider, etc.
```

Select via env: `SANDBOX_PROVIDER=opensandbox | e2b | docker`

### Dual-Channel Communication

```
Control Worker
    ├── Channel 1: SandboxProvider (infra) → execd (:44772)
    └── Channel 2: AgentBridge (business) → Agent Worker (Hono :8787)
```

### PoC Validation (Phase 0 Week 1)

| # | Blocker | Pass Criteria |
|---|---------|---------------|
| 1 | Agent Worker + execd coexistence | Stable 30 min, no OOM/crash |
| 2 | SandboxProvider interface coverage | 78 sandbox tests green |
| 3 | Interactive CLI support | SSE streaming complete, SIGINT works |

---

## Phases

### Phase 0: Infrastructure (Week 1-2)

- [ ] OpenSandbox PoC
- [ ] Monorepo skeleton (pnpm, turborepo, biome, vitest, tsup)
- [ ] CI: GitHub Actions + Dependabot
- [ ] Docker Compose (PostgreSQL + Redis + OpenSandbox + MinIO) — one-click dev env
- [ ] Open source governance (SECURITY.md, CONTRIBUTING, CODEOWNERS, issue/PR templates)
- [ ] `packages/contracts` — Zod schemas
- [ ] `packages/db` — Drizzle schema + migration policy (up/down, rollback, CI gate)
- [ ] `packages/stream` — Redis resumable SSE + idempotency protocol (dedup, sequence, gap detection)
- [ ] `packages/control-plane` — RunService, EventStore, FinalizationStateMachine
- [ ] `apps/control-worker` — pg-boss consumer + state machine
- [ ] `packages/sandbox` — SandboxProvider (with allocator abstraction for future pooling) + OpenSandboxProvider
- [ ] Credential Proxy — sidecar auth proxy
- [ ] Minimal observability — request_id propagation + structured JSON logging (pino)
- [ ] Security baseline — STRIDE threat model + hardening checklist
- [ ] Env var config + standard OTEL base

**Tests:** ~400

### Phase 1: AI Core (Week 3-5)

- [ ] `packages/agent-runtime` — Claude Code provider (Anthropic API / Bedrock / custom endpoint)
- [ ] `apps/agent-worker` — Hono + streamText + UIMessageStream
- [ ] Agent Bridge — SSE① communication
- [ ] Checkpoint & Recovery
- [ ] Stream middleware pipeline
- [ ] Agent Executor (prepareAgentContext + executeWithContext)
- [ ] `apps/web` — Next.js 16 + React 19 + Tailwind 4 + shadcn/ui
- [ ] Auth — NextAuth.js v5 (GitHub OAuth)
- [ ] SSE② endpoint
- [ ] Minimal credential layer — encrypted storage + scoped injection (before full Vault)
- [ ] Minimal RBAC — Owner/Member roles + unified auth guard across 3 layers
- [ ] AI Provider resilience — fallback chain, budget limit, timeout, rate control

**Tests:** ~1,500

### Phase 2a: MVP Core Loop (Week 6-9)

- [ ] Project management (CRUD, members, trash)
- [ ] Conversation system (messages, title generation)
- [ ] File management (S3-compatible)
- [ ] Preview & Dev Server (Vite, HMR, screenshots)
- [ ] Version management (history, publish, rollback)
- [ ] Deployment (S3 + CDN)
- [ ] Permission model enforcement

**Tests:** ~2,500. **Public repo after this phase.**

### Phase 2b: Experience Enhancement (Week 10-11)

- [ ] `packages/ai-components` — 64 React AI components
- [ ] Vault — full credential management + type-based injection strategy
- [ ] Template system — template registry + scaffolding
- [ ] Extension API v1 contract (for Skills/MCP plugin ecosystem)

**Tests:** ~3,500

### Phase 3: Ecosystem (Week 12-15)

- [ ] `packages/skills` — runtime, discovery, permissions
- [ ] `packages/mcp` — registry, lifecycle, probe, config
- [ ] `packages/memory` — pgvector, hybrid search, auto-extraction
- [ ] Agent config system
- [ ] Admin panel

**Tests:** ~4,500

### Phase 4: GA (Week 16-18)

- [ ] Enhanced observability — full OTEL spans + metrics + cost dashboard
- [ ] LLM Tracing
- [ ] Rate limiting (Redis)
- [ ] RBAC enhancement (fine-grained roles, audit logs)
- [ ] Documentation site
- [ ] E2E tests (Playwright)
- [ ] BatchSandbox resource pools + auto-reclaim (swap into existing SandboxAllocator)

**Tests:** ~5,000+

**i18n deferred** — tracked separately, not blocking GA.

---

## Schema (Drizzle)

```
users          UNIQUE(provider, provider_id), email unique where not null
projects       soft delete, sandbox_type (opensandbox | docker)
project_members  role (owner|editor|viewer), UNIQUE(project_id, user_id)
agents         nullable project_id (global agents)
runs           15-state machine, parent_run_id for follow-ups
conversations  linked to project + optional run
messages       UIMessage jsonb format
run_events     UNIQUE(run_id, cursor)
checkpoints    FK(run_id, event_cursor) → run_events DEFERRABLE
versions       build_status, artifact S3 path
skills         visibility, download/star counts
skill_versions semver + dist_tag
mcp_servers    transport type, config_template
project_mcp_config  per-project MCP config
user_memories  vector(1024), hybrid search
platform_tokens  hashed, expirable
```

---

## Test Strategy

### Principles

1. **All tests are original work** — written from scratch for this project
2. **Test-first development** — write test (red) → implement (green) → refactor
3. **Layered coverage** — schemas → business logic → API routes → components → E2E
4. **Tests as living specification** — each test describes a user-facing behavior, not implementation details

### Test Categories

| Category | Scope | Example |
|----------|-------|---------|
| Schema validation | Zod schemas accept/reject | `run status must be one of 15 valid states` |
| Business logic | State machines, services | `FinalizationStateMachine: uploading → verifying` |
| API routes | HTTP endpoint behavior | `POST /api/projects returns 201 with project` |
| Integration | Multi-module with real DB | `create project → start run → checkpoint → recover` |
| Component | React rendering + interaction | `model-selector displays models, fires onChange` |
| E2E | Full user flows (Playwright) | `sign in → create → chat → preview → deploy` |

### Convention

- Co-located: `foo.ts` → `foo.test.ts`
- Integration: `tests/integration/`
- E2E: `tests/e2e/`
- Test names describe scenario, not implementation

---

## Milestones

| Milestone | Week | Tests | Gate |
|-----------|------|-------|------|
| M0: Skeleton | 2 | ~400 | `pnpm build && pnpm test` green, security baseline documented |
| M1: Agent Loop | 5 | ~1,500 | prompt → sandbox → browser streaming, credentials encrypted |
| M2a: MVP Core | 9 | ~2,500 | create → chat → code → preview → deploy. **Public repo** |
| M2b: Experience | 11 | ~3,500 | 64 components + Vault + templates + extension API v1 |
| M3: Ecosystem | 15 | ~4,500 | skills + MCP + memory working |
| M4: GA | 18 | ~5,000+ | OTEL enhanced + RBAC + docs + E2E + BatchSandbox |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| OpenSandbox PoC fails | SandboxProvider interface; write Docker/E2B adapter |
| Timeline too aggressive | M2a is hard deadline; M2b/3/4 can slip |
| Test coverage ambitious | Incremental targets per milestone; prioritize critical paths |
| Pause/Resume state loss | Checkpoint mechanism + recovery protocol |
| Stream duplicate/out-of-order | Idempotency key + sequence protocol from M0 |
| AI provider outage / cost spike | Fallback chain + budget limit + timeout from M1 |
| Credential leakage via prompt injection | Credential Proxy (M0) + Vault (M2b) + output sanitizer + network egress deny |
