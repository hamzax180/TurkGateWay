import {
  pgTable, serial, text, boolean, integer, timestamp, varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  hashed_password: text('hashed_password').notNull(),
  full_name: text('full_name'),
  is_active: boolean('is_active').default(true),
  latest_dashboard_state: text('latest_dashboard_state'),
  subscription_status: varchar('subscription_status', { length: 50 }).default('free'),
  subscription_reference_code: text('subscription_reference_code'),
  is_admin: boolean('is_admin').default(false),
  token_balance: integer('token_balance').default(25),
  last_token_reset: timestamp('last_token_reset').defaultNow(),
  mfa_secret: text('mfa_secret'),
  mfa_enabled: boolean('mfa_enabled').default(false),
  api_key: text('api_key').unique(),
});

export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  user_id: integer('user_id').references(() => users.id),
  title: text('title'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
  dashboard_state: text('dashboard_state'),
  assistant_type: varchar('assistant_type', { length: 20 }).default('permit'),
  is_favorite: boolean('is_favorite').default(false),
  service_id: text('service_id'),
  service_slots: text('service_slots'),
  language: varchar('language', { length: 10 }).default('en'),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  session_id: text('session_id').references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 10 }).notNull(),
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});

export const learningResponses = pgTable('learning_responses', {
  id: serial('id').primaryKey(),
  query: text('query').notNull(),
  response: text('response').notNull(),
  assistant_type: varchar('assistant_type', { length: 20 }),
  intent: varchar('intent', { length: 100 }),
  language: varchar('language', { length: 10 }).default('en'),
  created_at: timestamp('created_at').defaultNow(),
  usage_count: integer('usage_count').default(0),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

// ---------------------------------------------------------------------------
// RAG / Knowledge base tables (pgvector — created via setup-pgvector.mjs)
// The embedding column is a native vector(768) in the DB;
// drizzle-orm does not have a built-in vector type so we track metadata here
// and use raw SQL (neon template tag) for similarity search in rag.ts.
// ---------------------------------------------------------------------------
export const knowledgeArticles = pgTable('knowledge_articles', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  category: varchar('category', { length: 50 }),
  agent_type: varchar('agent_type', { length: 20 }).notNull(),
  tags: text('tags'),
  created_at: timestamp('created_at').defaultNow(),
});

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: serial('id').primaryKey(),
  article_id: integer('article_id').references(() => knowledgeArticles.id, { onDelete: 'cascade' }),
  chunk_text: text('chunk_text').notNull(),
  // embedding stored as text JSON array — queried via raw SQL with pgvector
  embedding_json: text('embedding_json'),
  created_at: timestamp('created_at').defaultNow(),
});

export const responseTemplates = pgTable('response_templates', {
  id: serial('id').primaryKey(),
  assistant_type: varchar('assistant_type', { length: 20 }).notNull(),
  intent_key: text('intent_key').notNull(),
  responses: text('responses').notNull(), // JSON array string
  updated_at: timestamp('updated_at').defaultNow(),
});
