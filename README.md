# Rush

Open-source AI agent platform — powered by Claude Code, running in sandboxed containers.

Build web apps, automate workflows, execute code, manage projects — all through conversation with an AI agent that has full access to a real development environment.

## Status

**Pre-alpha** — actively under development. See [Roadmap](docs/roadmap.md) for the full plan.

## What Rush Does

- **Conversational development** — Chat with Claude Code to build, debug, and deploy software
- **Sandboxed execution** — Every project runs in an isolated container with its own filesystem, dev server, and tools
- **Live preview** — See changes in real-time as the agent writes code
- **Version management** — Track, publish, and rollback project versions
- **Skills & MCP** — Extend agent capabilities with a plugin marketplace and Model Context Protocol servers
- **Memory** — Agent learns your preferences across sessions
- **Multi-tenant** — Per-user projects, credentials, and permissions

## Architecture

Three-layer design with pluggable sandbox isolation:

```
Browser
  │
  │  SSE (streaming UI)
  ▼
apps/web (Next.js 16)          — User Portal + Control API
  │
  │  pg-boss queue
  ▼
apps/control-worker             — Orchestration engine + state machine
  │
  │  SandboxProvider interface
  ▼
Sandbox Container
  ├── apps/agent-worker (Hono)  — Claude Code agent execution
  ├── Workspace files            — Project source code
  └── Dev server                 — Live preview
```

## Key Design Decisions

- **Pluggable sandbox** — `SandboxProvider` interface decouples orchestration from container runtime. Bring your own: OpenSandbox, E2B, Docker, Fly.io, etc.
- **Vault-based credential management** — Platform Vault (admin-managed, invisible to users) + User Vault (self-service). Credentials auto-routed through Credential Proxy or controlled injection based on type
- **Claude Code native** — Single agent runtime, three connection modes (Anthropic API / Bedrock / custom endpoint)
- **Zero vendor lock-in** — standard OTEL, NextAuth.js, S3-compatible storage, Drizzle ORM
- **Spec-driven** — features defined in `specs/` before implementation

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
