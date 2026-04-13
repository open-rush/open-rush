CREATE TABLE "project_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"config_override" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_agents_project_agent_idx" UNIQUE("project_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "name" varchar(120) DEFAULT 'New Agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "icon" varchar(50);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "provider_type" varchar(50) DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model" varchar(255);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "mcp_servers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "max_steps" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "delivery_mode" varchar(20) DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "is_builtin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "agents" SET "status" = 'inactive' WHERE "status" = 'closed';--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "project_agents" ("project_id", "agent_id", "is_current", "config_override", "created_at", "updated_at")
SELECT
	"project_id",
	"id",
	CASE
		WHEN row_number() OVER (
			PARTITION BY "project_id"
			ORDER BY "last_active_at" DESC, "created_at" DESC, "id" DESC
		) = 1 THEN true
		ELSE false
	END,
	NULL,
	"created_at",
	"updated_at"
FROM "agents"
ON CONFLICT ("project_id","agent_id") DO NOTHING;--> statement-breakpoint
CREATE INDEX "project_agents_project_id_idx" ON "project_agents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_agents_agent_id_idx" ON "project_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_agents_current_idx" ON "project_agents" USING btree ("project_id") WHERE "project_agents"."is_current" = true;--> statement-breakpoint
CREATE INDEX "agents_project_status_idx" ON "agents" USING btree ("project_id","status");