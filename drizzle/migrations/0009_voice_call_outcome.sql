-- What a voice call decided, stored alongside its transcript.
--
-- The call's entire job is intake: find which of the four services the caller
-- needs and the one detail that pins it down. Until now that outcome existed
-- only as a chip on screen during the call and was thrown away on hang-up, so
-- a completed call left a transcript nobody could query and no record of what
-- the caller actually asked for.
--
-- `service` deliberately uses the same four ids the chat UI already uses for
-- its service chips, so a call and a typed conversation record the same value
-- for the same choice rather than needing a translation table.
--
-- Both columns are nullable: hanging up before choosing is an ordinary
-- outcome, not a failure, and a NULL here says exactly that.
ALTER TABLE "voice_call_transcripts" ADD COLUMN IF NOT EXISTS "service" varchar(32);
--> statement-breakpoint
ALTER TABLE "voice_call_transcripts" ADD COLUMN IF NOT EXISTS "detail" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_call_transcripts_service_idx" ON "voice_call_transcripts" ("service");
