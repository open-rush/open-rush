CREATE TABLE "service_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_tokens_token_hash_uniq" ON "service_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "service_tokens_owner_idx" ON "service_tokens" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "service_tokens_active_idx" ON "service_tokens" USING btree ("token_hash") WHERE "service_tokens"."revoked_at" IS NULL;