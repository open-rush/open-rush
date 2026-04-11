# Rush

Enterprise AI agent infrastructure — self-hosted, multi-scenario, built for every team member.

Deploy once, empower everyone. Developers automate with CLI and API. Non-technical teams build apps, analyze data, and generate content through conversation. All running on sandboxed Claude Code agents in your own infrastructure.

## Status

**Pre-alpha** — actively under development. See [Roadmap](docs/roadmap.md) for the full plan.

## Vision

```
Entry Points (multi-entry)                    Scenarios (multi-scenario)
┌─────────────────────┐                       ┌─────────────────────┐
│ Web UI    — everyone │                       │ Web app building    │
│ CLI       — devs     │──── Rush Platform ───►│ Code generation     │
│ API       — systems  │                       │ Data analysis       │
│ SDK       — embed    │                       │ Workflow automation  │
└─────────────────────┘                       │ Document generation  │
                                              │ Multimodal tasks     │
                                              └─────────────────────┘
```

## Current Scope

The initial release (M0–M4) focuses on the **platform layer + web app building + Web UI entry**. CLI, API, SDK, and additional scenarios are planned for subsequent releases.

## Architecture

Three-layer design with pluggable sandbox isolation:

```
Browser / CLI / API
  │
  │  SSE (streaming)
  ▼
apps/web (Next.js 16)          — Portal + Control API
  │
  │  pg-boss queue
  ▼
apps/control-worker             — Orchestration + state machine
  │
  │  SandboxProvider interface
  ▼
Sandbox Container
  ├── apps/agent-worker (Hono)  — Claude Code agent execution
  ├── Workspace files
  └── Dev server
```

## Platform Capabilities

| Capability | Description |
|-----------|-------------|
| **Agent orchestration** | Conversation, task dispatch, 15-state machine, checkpoint recovery |
| **Sandbox isolation** | Per-task containers, pluggable runtime (OpenSandbox, E2B, Docker...) |
| **Skills & MCP** | Plugin marketplace + Model Context Protocol servers |
| **Memory** | Cross-session learning, user preferences, pgvector search |
| **Vault** | Dual-layer credential management (platform + user), auto-routed injection |
| **Multi-tenant** | Per-user projects, RBAC, isolated workspaces |
| **Observability** | OpenTelemetry traces + metrics + LLM cost tracking |

## Key Design Decisions

- **Pluggable sandbox** — `SandboxProvider` interface. Bring your own container runtime
- **Dual-layer Vault** — Platform Vault (admin, invisible) + User Vault (self-service). Credentials auto-routed through Credential Proxy or controlled injection
- **Claude Code native** — Single agent runtime, three connection modes (Anthropic API / Bedrock / custom endpoint)
- **Zero vendor lock-in** — Standard OTEL, NextAuth.js, S3-compatible storage, Drizzle ORM
- **Spec-driven** — Features defined in `specs/` before implementation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind 4, shadcn/ui |
| Backend | Hono (agent), pg-boss (queue), Drizzle ORM |
| AI | Claude Code (Anthropic API / Bedrock / custom endpoint) |
| Database | PostgreSQL 16 + pgvector |
| Sandbox | Pluggable — any container runtime via SandboxProvider |
| Cache | Redis (resumable SSE streams) |
| Storage | S3-compatible (MinIO local, AWS production) |
| Auth | NextAuth.js v5 (GitHub OAuth default) |
| Observability | OpenTelemetry (standard) |

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| M0: Skeleton | Week 2 | In Progress |
| M1: Agent Loop | Week 5 | Planned |
| M2a: MVP Core | Week 9 | Planned |
| M2b: Experience | Week 11 | Planned |
| M3: Ecosystem | Week 15 | Planned |
| M4: GA | Week 18 | Planned |

## Development

```bash
# Prerequisites: Node.js 22+, pnpm, Docker

# Start local environment
docker compose up -d

# Install dependencies
pnpm install

# Run all checks
pnpm build && pnpm check && pnpm test && pnpm lint
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) (coming soon).

## License

[MIT](LICENSE)
