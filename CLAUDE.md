# Rush Development Guide

## Tech Stack

- **Runtime**: Node.js 22+, pnpm monorepo, TypeScript strict, ESM
- **Build**: Turborepo (orchestration), tsup (packages), Next.js (web)
- **Quality**: Biome (lint + format), Vitest (testing)
- **Database**: PostgreSQL 16 + pgvector, Drizzle ORM
- **Queue**: pg-boss
- **Cache**: Redis (resumable SSE streams)
- **Web**: Next.js 16, React 19
- **Agent**: Hono (agent-worker HTTP server), Claude Code
- **Auth**: NextAuth.js v5
- **Observability**: OpenTelemetry

## Architecture

Three-layer design:

1. **apps/web** — Next.js frontend + control API + SSE endpoints
2. **apps/control-worker** — pg-boss job processor, RunStateMachine, agent bridge
3. **apps/agent-worker** — Hono server running inside sandbox, wraps Claude Code

Shared packages under `packages/`:
- **contracts** — Shared types and Zod schemas
- **db** — Drizzle ORM schema and migrations
- **control-plane** — Business logic (runs, projects, users)
- **sandbox** — SandboxProvider interface + OpenSandbox default
- **agent-runtime** — Agent execution runtime
- **stream** — Redis-backed resumable SSE streams
- **integrations** — External service integrations
- **ai-components** — AI-powered UI components
- **skills** — Agent skill system
- **mcp** — Model Context Protocol server/client
- **memory** — Cross-session agent memory (pgvector)

## Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages and apps
pnpm check            # TypeScript type checking
pnpm test             # Run all tests
pnpm lint             # Biome lint
pnpm format           # Biome format (auto-fix)
pnpm dev              # Start all dev servers
pnpm dev:web          # Start web dev server only
```

## Conventions

- All code is ESM (`"type": "module"`)
- Packages build with tsup (dual ESM + CJS output)
- Workspace references use `"workspace:*"`
- TypeScript strict mode, no `any`
- Biome enforces formatting and linting — run `pnpm format` before committing
- Tests use Vitest with workspace-level config
