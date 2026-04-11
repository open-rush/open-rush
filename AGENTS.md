# Rush — AI Agent Instructions

## Project Overview

Rush is an enterprise AI agent infrastructure platform. Self-hosted, multi-scenario, built for every team member.

## Repository Structure

```
apps/
  web/              — Next.js 16 frontend (UI + control API + SSE)
  control-worker/   — pg-boss job processor (task orchestration)
  agent-worker/     — Hono server (runs inside sandbox with Claude Code)

packages/
  contracts/        — Shared TypeScript types + Zod schemas
  db/               — Drizzle ORM schema + migrations (PostgreSQL)
  control-plane/    — Business logic layer
  sandbox/          — SandboxProvider interface (pluggable runtimes)
  agent-runtime/    — Agent execution runtime
  stream/           — Redis-backed resumable SSE streams
  integrations/     — External service integrations
  ai-components/    — AI-powered UI components
  skills/           — Agent skill system
  mcp/              — Model Context Protocol server/client
  memory/           — Cross-session agent memory (pgvector)
```

## Key Design Decisions

1. **Claude Code only** — No multi-provider abstraction. Three connection modes: Anthropic API / AWS Bedrock / custom endpoint.
2. **Pluggable sandbox** — `SandboxProvider` interface. OpenSandbox is default. Users can switch to E2B, Docker, etc.
3. **Dual-layer Vault** — Platform Vault (admin-managed, invisible to users) + User Vault (self-service). MVP uses env injection.
4. **Three-layer architecture** — web → control-worker → agent-worker (in sandbox).

## Development Workflow

```bash
pnpm install && pnpm build && pnpm check && pnpm lint
```

All four commands must pass before submitting changes.

## Coding Standards

- TypeScript strict mode, ESM only
- No `any` types (enforced by Biome)
- Biome for formatting (2-space indent, single quotes, trailing commas)
- Vitest for all tests
- Packages export via tsup (dual ESM + CJS)
