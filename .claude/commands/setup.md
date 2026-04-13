Execute the OpenRush development environment setup. Follow each step sequentially, stop and diagnose if any step fails.

## Prerequisites Check

### 1. Node.js

```bash
node --version
```

Require 22.x. If not available, install via nvm:
```bash
nvm install 22 && nvm use 22
```

### 2. pnpm

```bash
pnpm --version
```

Require 10.x. If not available:
```bash
corepack enable && corepack prepare pnpm@latest --activate
```

### 3. Docker

```bash
docker --version && docker info --format '{{.ServerVersion}}'
```

If Docker is not installed:
- macOS: `brew install --cask docker`, then open Docker Desktop
- Linux: follow https://docs.docker.com/engine/install/

If the daemon is not running (docker info fails), tell the user to open Docker Desktop and wait for it to start, then re-run `/setup`.

## Step 1: Start Infrastructure (PostgreSQL + Redis + MinIO)

```bash
pnpm db:up
```

This starts three services via `docker/docker-compose.dev.yml`:
- **PostgreSQL 16** (pgvector) — port 5432, user/pass/db: rush/rush/rush
- **Redis 7** — port 6379
- **MinIO** (S3-compatible storage) — API port 9000, Console port 9001, user/pass: minioadmin/minioadmin

Verify all services are healthy:
```bash
docker compose -f docker/docker-compose.dev.yml ps
```

All three should show `healthy` status.

## Step 2: Install Dependencies

```bash
pnpm install
```

## Step 3: Build All Packages

```bash
pnpm build
```

## Step 4: Push Database Schema

```bash
pnpm db:push
```

The init script (`docker/init-db/01-extensions.sql`) has already enabled required extensions: uuid-ossp, pgcrypto, vector.

Verify tables were created:
```bash
docker exec $(docker ps -q -f name=postgres) psql -U rush -d rush -c "\dt"
```

Should see 17+ tables including: users, projects, project_members, agents, runs, run_events, run_checkpoints, conversations, messages, artifacts, vault_entries, etc.

## Step 5: Run Quality Gates

```bash
pnpm check && pnpm lint && pnpm test
```

All three must pass. If lint fails, auto-fix with `pnpm format`.

## Step 6: Environment Variables (Optional)

For AI features, create `apps/web/.env.local`:
```bash
cat > apps/web/.env.local << 'ENVEOF'
DATABASE_URL=postgresql://rush:rush@localhost:5432/rush
REDIS_URL=redis://localhost:6379

# Auth (GitHub OAuth — create at https://github.com/settings/developers)
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_SECRET=any-random-string

# AI — choose one:
# Anthropic API
ANTHROPIC_API_KEY=
# AWS Bedrock
# CLAUDE_CODE_USE_BEDROCK=1
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=us-west-2
# ANTHROPIC_MODEL=
ENVEOF
```

Without these, the web app will start but auth and AI features won't work.

## Done

Print a summary:

```
✅ OpenRush development environment ready

Infrastructure:
  PostgreSQL:  localhost:5432  (rush/rush/rush, pgvector enabled)
  Redis:       localhost:6379
  MinIO:       localhost:9000  (console: localhost:9001)

Quick commands:
  pnpm dev        — Start all dev servers (web on :3000)
  pnpm dev:web    — Start web only
  pnpm db:studio  — Open Drizzle Studio (DB browser)
  pnpm db:reset   — Reset database (destroy + recreate)
  pnpm test       — Run all tests
  pnpm check      — TypeScript type check
  pnpm lint       — Biome lint
```
