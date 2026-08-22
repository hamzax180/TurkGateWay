CREATE TABLE "application_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"kind" varchar(40) DEFAULT 'acceptance_letter' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "application_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"partner_id" integer NOT NULL,
	"programme" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"responded_at" timestamp,
	"commission_minor" integer,
	"commission_status" varchar(20),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"session_id" text NOT NULL,
	"user_id" integer,
	"status" varchar(20) DEFAULT 'collecting' NOT NULL,
	"data" text DEFAULT '{}' NOT NULL,
	"credit_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"purge_after" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "university_partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"apply_via" text,
	"commission_bps" integer,
	"commission_flat_minor" integer,
	"currency" varchar(3) DEFAULT 'USD',
	"agreement_ref" text,
	"active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_partner_id_university_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."university_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_credit_id_service_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."service_credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_submissions_app_idx" ON "application_submissions" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_session_kind_idx" ON "applications" USING btree ("session_id","kind");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("kind","status","created_at");