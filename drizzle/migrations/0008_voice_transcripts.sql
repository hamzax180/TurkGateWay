-- Voice call transcripts, stored apart from the chat thread.
--
-- Voice turns used to be written straight into chat_messages by the same code
-- path that handles typing, so a call left dozens of verbatim speech rows in
-- the thread. Two problems with that: the thread became unreadable, and the
-- recognition noise in those rows was replayed as model context on every
-- later question in the session.
--
-- The turns now live here, one row per call, and the thread keeps a single
-- message pointing at that row through chat_messages.transcript_id.
--
-- Turns are stored as JSON text rather than as a rendered file, matching how
-- chat_sessions.dashboard_state and service_slots already hold JSON. The
-- download route formats the .txt on demand, so its layout can change without
-- a migration and without rewriting stored rows.
CREATE TABLE IF NOT EXISTS "voice_call_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text,
	"user_id" integer,
	"turns" text NOT NULL,
	"duration_seconds" integer DEFAULT 0,
	"language" varchar(10) DEFAULT 'en',
	"assistant_type" varchar(20) DEFAULT 'permit',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
-- Deleting a chat session takes its calls with it; deleting a user does not,
-- so a transcript outlives the account row it was made under rather than
-- disappearing from an admin's view mid-dispute.
ALTER TABLE "voice_call_transcripts" ADD CONSTRAINT "voice_call_transcripts_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_call_transcripts" ADD CONSTRAINT "voice_call_transcripts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_call_transcripts_session_idx" ON "voice_call_transcripts" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_call_transcripts_user_time_idx" ON "voice_call_transcripts" ("user_id","created_at");
--> statement-breakpoint
-- The link from the thread back to the call. Nullable and unconstrained by a
-- foreign key on purpose: a purged transcript should render as a plain "voice
-- call happened" line rather than block the message row from loading.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "transcript_id" integer;
