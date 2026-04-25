ALTER TABLE "runs" ADD COLUMN "agent_definition_version" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idempotency_request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "definition_version" integer;--> statement-breakpoint
CREATE INDEX "runs_idempotency_lookup_idx" ON "runs" USING btree ("idempotency_key","created_at" DESC) WHERE "runs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
-- Backfill tasks.definition_version = 1 for all existing agents (they're all v1 after 0009).
-- See specs/agent-definition-versioning.md §tasks 表 §initial migration.
UPDATE "tasks" SET "definition_version" = 1
WHERE "agent_id" IS NOT NULL AND "definition_version" IS NULL;--> statement-breakpoint
-- Backfill runs.agent_definition_version from tasks.definition_version (primary path).
UPDATE "runs" SET "agent_definition_version" = t."definition_version"
FROM "tasks" t
WHERE "runs"."task_id" = t."id" AND "runs"."agent_definition_version" IS NULL;--> statement-breakpoint
-- Backfill runs without task_id (historical runs) from agents.current_version.
UPDATE "runs" SET "agent_definition_version" = a."current_version"
FROM "agents" a
WHERE "runs"."agent_id" = a."id" AND "runs"."agent_definition_version" IS NULL;
