import {
  pgTable, serial, text, boolean, integer, timestamp, varchar, customType, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Raw binary column. drizzle-orm has no built-in bytea type. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Native pgvector column — drizzle has no vector type, rag.ts queries it via raw SQL. */
const vector768 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'vector(768)';
  },
});

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
  /**
   * A generated document (filled application form PDF) attached to this
   * assistant message. Points at application_documents.id — the download
   * route re-checks ownership, and a purged row simply renders as a name
   * with no link.
   */
  attachment_id: integer('attachment_id'),
  attachment_filename: text('attachment_filename'),
  /**
   * A voice call whose transcript is kept out of this thread. Points at
   * voice_call_transcripts.id. Set only on the single placeholder message a
   * finished call leaves behind, so the thread records that the call happened
   * without carrying its turns.
   */
  transcript_id: integer('transcript_id'),
});

/**
 * What was said on a voice call, kept out of chat_messages on purpose.
 *
 * A call is a different kind of record from a chat. It is long, it is verbatim,
 * and it is full of speech-recognition noise — half-words, repeated openings,
 * the caller talking over the agent. Interleaving that with typed conversation
 * made threads unreadable and, worse, fed the noise back as model context on
 * the next question.
 *
 * So the turns live here, one row per call, and the thread keeps a single
 * message pointing at this row. The text is stored rather than the rendered
 * file: the download route formats it on demand, which means the .txt layout
 * can change later without a migration.
 */
export const voiceCallTranscripts = pgTable('voice_call_transcripts', {
  id: serial('id').primaryKey(),
  session_id: text('session_id').references(() => chatSessions.id, { onDelete: 'cascade' }),
  /** Kept even if the session is gone, so a user can still be shown their own calls. */
  user_id: integer('user_id').references(() => users.id),
  /** JSON: [{ role: 'user' | 'assistant', content: string }] in spoken order. */
  turns: text('turns').notNull(),
  /** Wall-clock length of the call, as the UI counted it. */
  duration_seconds: integer('duration_seconds').default(0),
  language: varchar('language', { length: 10 }).default('en'),
  assistant_type: varchar('assistant_type', { length: 20 }).default('permit'),
  /**
   * What the call actually established — the whole point of the intake.
   *
   * One of 'university' | 'visa' | 'ikamet' | 'insurance', matching the ids the
   * chat UI already uses for its service chips, so a call and a typed
   * conversation produce the same value for the same choice.
   *
   * Null when the caller hung up before saying what they needed, which is a
   * real and expected outcome rather than a failure.
   */
  service: varchar('service', { length: 32 }),
  /** The single detail that pinned the service down — nationality, university, first-vs-extension. */
  detail: text('detail'),
  created_at: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// Billing — pay-per-service credits
//
// One credit buys one finalised roadmap. Credits are stored as ONE ROW EACH
// rather than an integer counter on `users`, because each credit needs its own
// expiry date, its own provenance (bought directly vs granted by a family
// plan), and its own audit trail when a user disputes a charge. A counter
// cannot express "3 credits, two of which expire in March".
// ---------------------------------------------------------------------------

export const purchases = pgTable('purchases', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id').references(() => users.id).notNull(),
  /** 'single' | 'family' | 'bulk' */
  plan: varchar('plan', { length: 20 }).notNull(),
  /** Amount actually charged, in kuruş, to avoid float rounding on money. */
  amount_try_minor: integer('amount_try_minor').notNull(),
  /** Display-only USD equivalent shown at purchase time, in cents. */
  amount_usd_minor: integer('amount_usd_minor'),
  credits_granted: integer('credits_granted').notNull(),
  /** iyzico paymentId / token, once verified. */
  provider_ref: text('provider_ref'),
  /** Correlates our request with the provider callback. */
  conversation_id: text('conversation_id').unique(),
  /** 'pending' | 'paid' | 'failed' — only 'paid' ever mints credits. */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  created_at: timestamp('created_at').defaultNow(),
  paid_at: timestamp('paid_at'),
});

export const serviceCredits = pgTable('service_credits', {
  id: serial('id').primaryKey(),
  /**
   * Who may spend this credit. NULL means it is reserved for a family invite
   * that has not been claimed yet — reserved credits are spendable by nobody,
   * which is what stops the buyer from double-spending a seat they gave away.
   */
  owner_user_id: integer('owner_user_id').references(() => users.id),
  purchase_id: integer('purchase_id').references(() => purchases.id).notNull(),
  /** 'purchase' (bought it themselves) | 'family' (received a seat) */
  source: varchar('source', { length: 20 }).notNull().default('purchase'),
  expires_at: timestamp('expires_at').notNull(),
  /** NULL = unspent. Set atomically at the moment of consumption. */
  consumed_at: timestamp('consumed_at'),
  consumed_session_id: text('consumed_session_id'),
  created_at: timestamp('created_at').defaultNow(),
});

export const familyInvites = pgTable('family_invites', {
  id: serial('id').primaryKey(),
  purchase_id: integer('purchase_id').references(() => purchases.id).notNull(),
  inviter_user_id: integer('inviter_user_id').references(() => users.id).notNull(),
  /** Always stored lowercased so matching on signup is case-insensitive. */
  email: varchar('email', { length: 255 }).notNull(),
  /** The specific credit held for this invitee. */
  credit_id: integer('credit_id').references(() => serviceCredits.id).notNull(),
  /** Shareable secret — no email infrastructure exists, so links are the delivery. */
  invite_token: text('invite_token').unique().notNull(),
  /** 'pending' | 'accepted' | 'revoked' */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  accepted_user_id: integer('accepted_user_id').references(() => users.id),
  created_at: timestamp('created_at').defaultNow(),
  accepted_at: timestamp('accepted_at'),
});

/** Append-only history. Never updated — one row per state change of a credit. */
export const creditLedger = pgTable('credit_ledger', {
  id: serial('id').primaryKey(),
  credit_id: integer('credit_id').references(() => serviceCredits.id).notNull(),
  user_id: integer('user_id').references(() => users.id),
  /** 'granted' | 'reserved' | 'assigned' | 'consumed' | 'refunded' | 'expired' */
  action: varchar('action', { length: 20 }).notNull(),
  session_id: text('session_id'),
  note: text('note'),
  created_at: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// Applications
//
// One table for every kind of application the platform takes on for someone,
// distinguished by `kind`. Visa appointments and university placements need
// the same things — conversational intake, uploaded documents, a service
// credit, a status a human operator moves along — so they share a table
// rather than duplicating that stack per service.
//
// These hold passport-level PII and academic records, so they are short-lived
// by design: `purge_after` bounds how long a row may exist at all, and the
// operator deletes it outright once the work is delivered.
// ---------------------------------------------------------------------------

/**
 * 'visa_appointment' — Mosaic booking. 'university' — placement + registration.
 * 'criminal_case' — defense intake for the lawyer. 'ikamet' — residence permit
 * (first + renewal). 'insurance' — SGK student health insurance.
 * 'business' — İşyeri Açma ve Çalışma Ruhsatı application.
 */
export type ApplicationKind =
  | 'visa_appointment'
  | 'university'
  | 'criminal_case'
  | 'ikamet'
  | 'insurance'
  | 'business';

export const applications = pgTable(
  'applications',
  {
    id: serial('id').primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull(),
    session_id: text('session_id')
      .references(() => chatSessions.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: integer('user_id').references(() => users.id),
    /** 'collecting' | 'ready' | 'in_progress' | 'submitted' | 'done' */
    status: varchar('status', { length: 20 }).notNull().default('collecting'),
    /** Intake answers as JSON, shaped like the service's field list. */
    data: text('data').notNull().default('{}'),
    /** Set when a credit is spent, so the service is charged exactly once. */
    credit_id: integer('credit_id').references(() => serviceCredits.id),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
    /** Hard deadline for deletion, regardless of status. */
    purge_after: timestamp('purge_after').notNull(),
  },
  (t) => [
    // One application per service per conversation — a session may have both a
    // university placement and a visa appointment, but not two of either.
    uniqueIndex('applications_session_kind_idx').on(t.session_id, t.kind),
    // How the operator-side watcher claims work.
    index('applications_status_idx').on(t.kind, t.status, t.created_at),
  ],
);

/**
 * Uploaded supporting documents — acceptance letters, diplomas, transcripts.
 *
 * Kept in its own table rather than a column on `applications` so that reading
 * or listing an application never drags the file bytes along with it.
 */
export const applicationDocuments = pgTable('application_documents', {
  id: serial('id').primaryKey(),
  application_id: integer('application_id')
    .references(() => applications.id, { onDelete: 'cascade' })
    .notNull(),
  /** 'acceptance_letter' | 'diploma' | 'transcript' | 'passport' | 'language_certificate' */
  kind: varchar('kind', { length: 40 }).notNull().default('acceptance_letter'),
  filename: text('filename').notNull(),
  mime_type: varchar('mime_type', { length: 100 }).notNull(),
  size_bytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  uploaded_at: timestamp('uploaded_at').defaultNow(),
});

/**
 * Universities we can actually place students with.
 *
 * Commission is only collectable where a representation agreement exists — a
 * university with no agreement has nobody to invoice — so `agreement_ref`
 * records which contract each rate comes from rather than leaving the number
 * floating and unenforceable.
 */
export const universityPartners = pgTable('university_partners', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  city: text('city'),
  /** Where applications are actually sent — portal URL or admissions address. */
  apply_via: text('apply_via'),
  /** Commission as basis points of first-year tuition (1200 = 12%). */
  commission_bps: integer('commission_bps'),
  /** Or a flat fee per enrolment, where the agreement works that way. */
  commission_flat_minor: integer('commission_flat_minor'),
  currency: varchar('currency', { length: 3 }).default('USD'),
  /** The signed agreement this rate comes from. No reference, no invoice. */
  agreement_ref: text('agreement_ref'),
  active: boolean('active').default(true),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow(),
});

/**
 * One row per university a student is put forward to, carrying that
 * application through to the enrolment that earns the commission.
 */
export const applicationSubmissions = pgTable(
  'application_submissions',
  {
    id: serial('id').primaryKey(),
    application_id: integer('application_id')
      .references(() => applications.id, { onDelete: 'cascade' })
      .notNull(),
    partner_id: integer('partner_id')
      .references(() => universityPartners.id)
      .notNull(),
    programme: text('programme'),
    /** 'draft' | 'submitted' | 'accepted' | 'rejected' | 'enrolled' | 'withdrawn' */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    submitted_at: timestamp('submitted_at'),
    responded_at: timestamp('responded_at'),
    /** Filled on enrolment, when commission actually becomes owed. */
    commission_minor: integer('commission_minor'),
    /** 'pending' | 'invoiced' | 'paid' | 'written_off' */
    commission_status: varchar('commission_status', { length: 20 }),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (t) => [index('application_submissions_app_idx').on(t.application_id)],
);

// ---------------------------------------------------------------------------
// Usage ledger — one row per model call.
//
// Created by migration 0007 and, until now, absent from this file: the table
// existed in the database while drizzle believed it did not, so a `drizzle-kit
// push` would have offered to drop it. Declaring it here closes that drift.
//
// Spend was otherwise unmeasurable. Credits gate the deliverables, but the
// generation underneath is unmetered, so per-user cost, per-agent cost and
// runaway tool loops were all invisible.
//
// Token counts are facts from the provider and are always written. Cost is
// derived and stays NULL until a rate is configured for that model, so an
// unpriced model reads as "unpriced" rather than silently as free.
// ---------------------------------------------------------------------------

export const usageEvents = pgTable(
  'usage_events',
  {
    id: serial('id').primaryKey(),
    /** NULL for guests, and set null on account deletion — the cost still happened. */
    user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    session_id: text('session_id'),
    agent: varchar('agent', { length: 32 }),
    /** 'chat' | 'roadmap' | 'embedding' | 'vision' | 'voice' | 'automation' */
    purpose: varchar('purpose', { length: 32 }).notNull().default('chat'),
    model: varchar('model', { length: 64 }).notNull(),
    prompt_tokens: integer('prompt_tokens').notNull().default(0),
    completion_tokens: integer('completion_tokens').notNull().default(0),
    total_tokens: integer('total_tokens').notNull().default(0),
    /** Micro-USD (1e-6) so a sub-cent call is not rounded to zero. NULL = unpriced. */
    cost_micro_usd: integer('cost_micro_usd'),
    /** Set when the call was part of paid work, so a credit can be costed. */
    credit_id: integer('credit_id').references(() => serviceCredits.id),
    /** 'ok' | 'error' | 'aborted' */
    outcome: varchar('outcome', { length: 16 }).notNull().default('ok'),
    duration_ms: integer('duration_ms'),
    created_at: timestamp('created_at').defaultNow(),
  },
  (t) => [
    index('usage_events_user_time_idx').on(t.user_id, t.created_at),
    index('usage_events_time_idx').on(t.created_at),
    index('usage_events_model_idx').on(t.model, t.created_at),
  ],
);

export type UsageEvent = typeof usageEvents.$inferSelect;

// ---------------------------------------------------------------------------
// Customer service tickets
//
// The live-chat queue in support-queue.ts is ephemeral operational state — who
// is talking to whom right now. A ticket is the durable record of that contact:
// what it was about, who handled it, how long it took, and how it ended. That
// is what an operator needs the day after, and what the admin panel reports on.
//
// One ticket per support conversation, keyed to the chat session so the
// transcript in chat_messages is the ticket's history — no message duplication.
// ---------------------------------------------------------------------------

/** open — awaiting us. pending — awaiting the customer. resolved/closed — done. */
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: serial('id').primaryKey(),
    /** Customer-facing reference, e.g. TG-1042. Stable and quotable. */
    ref: varchar('ref', { length: 16 }).unique().notNull(),
    session_id: text('session_id')
      .references(() => chatSessions.id, { onDelete: 'cascade' })
      .notNull(),
    /** NULL for guests — support does not require an account. */
    user_id: integer('user_id').references(() => users.id),
    subject: text('subject').notNull().default('Customer service'),
    status: varchar('status', { length: 12 }).notNull().default('open'),
    priority: varchar('priority', { length: 10 }).notNull().default('normal'),
    /** Mirrors the FAQ sections: account | payments | credits | services | other */
    category: varchar('category', { length: 20 }).notNull().default('other'),
    /** Which of the five rostered agents took it. */
    agent: varchar('agent', { length: 32 }),
    language: varchar('language', { length: 10 }).default('en'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
    /** Drives first-response-time reporting; set on the agent's first reply. */
    first_response_at: timestamp('first_response_at'),
    last_message_at: timestamp('last_message_at').defaultNow(),
    resolved_at: timestamp('resolved_at'),
    /** 1-5 CSAT, once the customer answers "did this help?". */
    rating: integer('rating'),
    /** Operator-only notes, never shown to the customer. */
    internal_note: text('internal_note'),
  },
  (t) => [
    // One ticket per support conversation.
    uniqueIndex('support_tickets_session_idx').on(t.session_id),
    // The queue view: newest open work first.
    index('support_tickets_status_idx').on(t.status, t.created_at),
  ],
);

export type SupportTicket = typeof supportTickets.$inferSelect;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type ServiceCredit = typeof serviceCredits.$inferSelect;
export type FamilyInvite = typeof familyInvites.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type ApplicationDocument = typeof applicationDocuments.$inferSelect;
export type UniversityPartner = typeof universityPartners.$inferSelect;
export type ApplicationSubmission = typeof applicationSubmissions.$inferSelect;

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
  // Native vector(768) — what rag.ts (`kc.embedding <=>`), the reembed
  // script and the legacy SQLAlchemy schema all use. The text-JSON
  // `embedding_json` column migration 0000 created was never read by
  // anything; migration 0004 replaces it with this.
  embedding: vector768('embedding'),
  created_at: timestamp('created_at').defaultNow(),
});

