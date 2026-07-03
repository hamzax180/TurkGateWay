CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text,
	"role" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"dashboard_state" text,
	"assistant_type" varchar(20) DEFAULT 'permit',
	"is_favorite" boolean DEFAULT false,
	"service_id" text,
	"service_slots" text,
	"language" varchar(10) DEFAULT 'en'
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" varchar(50),
	"agent_type" varchar(20) NOT NULL,
	"tags" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer,
	"chunk_text" text NOT NULL,
	"embedding_json" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "learning_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"response" text NOT NULL,
	"assistant_type" varchar(20),
	"intent" varchar(100),
	"language" varchar(10) DEFAULT 'en',
	"created_at" timestamp DEFAULT now(),
	"usage_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "response_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"assistant_type" varchar(20) NOT NULL,
	"intent_key" text NOT NULL,
	"responses" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"hashed_password" text NOT NULL,
	"full_name" text,
	"is_active" boolean DEFAULT true,
	"latest_dashboard_state" text,
	"subscription_status" varchar(50) DEFAULT 'free',
	"subscription_reference_code" text,
	"is_admin" boolean DEFAULT false,
	"token_balance" integer DEFAULT 25,
	"last_token_reset" timestamp DEFAULT now(),
	"mfa_secret" text,
	"mfa_enabled" boolean DEFAULT false,
	"api_key" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_article_id_knowledge_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."knowledge_articles"("id") ON DELETE cascade ON UPDATE no action;