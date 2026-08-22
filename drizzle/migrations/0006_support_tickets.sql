CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" varchar(16) NOT NULL,
	"session_id" text NOT NULL,
	"user_id" integer,
	"subject" text DEFAULT 'Customer service' NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"category" varchar(20) DEFAULT 'other' NOT NULL,
	"agent" varchar(32),
	"language" varchar(10) DEFAULT 'en',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"first_response_at" timestamp,
	"last_message_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"rating" integer,
	"internal_note" text,
	CONSTRAINT "support_tickets_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_session_idx" ON "support_tickets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets" USING btree ("status","created_at");
