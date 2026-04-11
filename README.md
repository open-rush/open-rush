# Rush

Open-source AI web builder — build complete web apps through conversation.

## Status

**Pre-alpha** — actively under development. See [Roadmap](docs/roadmap.md) for the full plan.

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
  ├── apps/agent-worker (Hono)  — AI agent execution
  ├── Workspace files            — Project source code
  └── Vite dev server            — Live preview
```

## Key Design Decisions

- **Pluggable sandbox** — `SandboxProvider` interface decouples orchestration from container runtime. Bring your own: OpenSandbox, E2B, Docker, Fly.io, etc.
- **Test-driven** — comprehensive test suite as behavior specifications
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
| M2: MVP (Public Release) | Week 9 | Planned |
| M3: Ecosystem | Week 13 | Planned |
| M4: GA | Week 16 | Planned |

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
