-- Usage ledger: one row per model call.
--
-- Spend was previously unmeasurable. Credits gated the deliverables, but the
-- generation underneath was unmetered, so per-user cost, per-agent cost and
-- runaway tool loops were all invisible.
--
-- Token counts are facts from the provider and are always written. Cost is
-- derived and stays NULL until a rate is configured for that model, so an
-- unpriced model reads as "unpriced" rather than silently as free.
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"session_id" text,
	"agent" varchar(32),
	"purpose" varchar(32) DEFAULT 'chat' NOT NULL,
	"model" varchar(64) NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer,
	"credit_id" integer,
	"outcome" varchar(16) DEFAULT 'ok' NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_credit_id_service_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "service_credits"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_time_idx" ON "usage_events" ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_time_idx" ON "usage_events" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_model_idx" ON "usage_events" ("model","created_at");
