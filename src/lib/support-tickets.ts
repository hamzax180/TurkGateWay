/**
 * support-tickets.ts
 * The durable record behind every live-chat contact.
 *
 * support-queue.ts holds who is talking to whom *right now* and forgets it the
 * moment the tab closes. A ticket is what survives: the reference the customer
 * quotes back, the subject, who handled it, how fast we answered and how it
 * ended. The transcript itself is not copied here — chat_messages already has
 * it, keyed by the same session_id.
 *
 * Every function swallows DB errors on purpose. Support must keep working when
 * the database is unreachable; losing the record is bad, refusing to talk to a
 * customer is worse.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chatMessages, supportTickets, users } from '@/lib/schema';
import type { TicketPriority, TicketStatus } from '@/lib/schema';

export const TICKET_STATUSES: TicketStatus[] = ['open', 'pending', 'resolved', 'closed'];
export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Ticket numbers start at TG-1001 so the very first one does not read as a test. */
const REF_OFFSET = 1000;

export const formatRef = (id: number) => `TG-${id + REF_OFFSET}`;

/**
 * The ref is derived from the serial id, which does not exist until the row is
 * inserted — so the insert writes this placeholder and immediately replaces it.
 * Unique, so two in-flight inserts cannot both hold it.
 */
const REF_PLACEHOLDER = 'pending';

/**
 * Route a ticket to a category from what the customer opened with. Keeps the
 * admin queue filterable without asking the customer to classify their own
 * problem — nobody picks the right dropdown anyway.
 */
export function categorise(subject: string): string {
  const t = subject.toLowerCase();
  if (/refund|payment|paid|card|invoice|receipt|iyzico|charge|price|pricing/.test(t)) return 'payments';
  if (/credit|token|expire|family pack|balance/.test(t)) return 'credits';
  if (/password|2fa|account|login|sign ?in|delete my account|security|email/.test(t)) return 'account';
  if (/visa|university|ikamet|residence|insurance|permit|appointment|service/.test(t)) return 'services';
  return 'other';
}

/**
 * Anything a customer opens with that reads as money-at-risk or account-lockout
 * jumps the normal queue. These are the two cases where a slow answer costs the
 * business a customer rather than just annoying one.
 */
export function prioritise(subject: string): TicketPriority {
  const t = subject.toLowerCase();
  if (/credits are missing|paid but|lost.*credit|charged twice|double charge|fraud|unauthori/.test(t)) return 'urgent';
  if (/refund|cannot log|can't log|locked out|2fa|password/.test(t)) return 'high';
  return 'normal';
}

/**
 * Open (or return) the ticket for a support conversation.
 *
 * Idempotent on session_id: the client re-joins the queue on every reconnect,
 * and a reconnect is the same contact, not a new one.
 */
export async function openTicket(opts: {
  sessionId: string;
  subject?: string | null;
  agent?: string | null;
  userId?: number | null;
  language?: string | null;
}): Promise<{ ref: string; id: number } | null> {
  const subject = (opts.subject || '').trim() || 'Customer service';

  try {
    const existing = await db
      .select({ id: supportTickets.id, ref: supportTickets.ref })
      .from(supportTickets)
      .where(eq(supportTickets.session_id, opts.sessionId))
      .limit(1);

    if (existing.length) {
      // Reconnect — record the agent now handling it, but never overwrite the
      // original subject or reopen a ticket an operator already closed.
      if (opts.agent) {
        await db
          .update(supportTickets)
          .set({ agent: opts.agent, updated_at: new Date() })
          .where(eq(supportTickets.id, existing[0].id));
      }

      // A concurrent join can read the row in the window between the insert
      // below and its ref update. The ref is a pure function of the id, so
      // repair it here rather than handing the customer a placeholder.
      if (existing[0].ref === REF_PLACEHOLDER) {
        const ref = formatRef(existing[0].id);
        await db.update(supportTickets).set({ ref }).where(eq(supportTickets.id, existing[0].id));
        return { id: existing[0].id, ref };
      }

      return existing[0];
    }

    // ref is derived from the serial id, so it cannot collide under concurrency
    // the way a counted-from-COUNT(*) reference would.
    const inserted = await db
      .insert(supportTickets)
      .values({
        ref: REF_PLACEHOLDER,
        session_id: opts.sessionId,
        user_id: opts.userId ?? null,
        subject: subject.slice(0, 300),
        category: categorise(subject),
        priority: prioritise(subject),
        agent: opts.agent ?? null,
        language: opts.language ?? 'en',
      })
      .returning({ id: supportTickets.id });

    if (!inserted.length) return null;

    const ref = formatRef(inserted[0].id);
    await db.update(supportTickets).set({ ref }).where(eq(supportTickets.id, inserted[0].id));
    return { id: inserted[0].id, ref };
  } catch {
    // No DB — the chat carries on unrecorded.
    return null;
  }
}

/** Stamp activity, and the first-response time the reporting depends on. */
export async function touchTicket(sessionId: string, opts: { agentReplied?: boolean } = {}) {
  try {
    const set: Record<string, unknown> = { last_message_at: new Date(), updated_at: new Date() };
    await db
      .update(supportTickets)
      .set(set)
      .where(eq(supportTickets.session_id, sessionId));

    if (opts.agentReplied) {
      // Only the *first* reply counts, so this must not overwrite an existing value.
      await db
        .update(supportTickets)
        .set({ first_response_at: new Date() })
        .where(
          and(eq(supportTickets.session_id, sessionId), sql`${supportTickets.first_response_at} is null`),
        );
    }
  } catch {
    /* best effort */
  }
}

export type TicketRow = {
  id: number;
  ref: string;
  session_id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  agent: string | null;
  language: string | null;
  created_at: Date | null;
  last_message_at: Date | null;
  first_response_at: Date | null;
  resolved_at: Date | null;
  rating: number | null;
  internal_note: string | null;
  user_email: string | null;
  message_count: number;
};

/** The admin queue view. */
export async function listTickets(opts: {
  status?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tickets: TicketRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;

  const filters = [];
  if (opts.status && opts.status !== 'all') filters.push(eq(supportTickets.status, opts.status));
  if (opts.priority && opts.priority !== 'all') filters.push(eq(supportTickets.priority, opts.priority));
  if (opts.search) {
    const q = `%${opts.search.toLowerCase()}%`;
    filters.push(sql`(lower(${supportTickets.subject}) like ${q} or lower(${supportTickets.ref}) like ${q})`);
  }
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: supportTickets.id,
      ref: supportTickets.ref,
      session_id: supportTickets.session_id,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      category: supportTickets.category,
      agent: supportTickets.agent,
      language: supportTickets.language,
      created_at: supportTickets.created_at,
      last_message_at: supportTickets.last_message_at,
      first_response_at: supportTickets.first_response_at,
      resolved_at: supportTickets.resolved_at,
      rating: supportTickets.rating,
      internal_note: supportTickets.internal_note,
      user_email: users.email,
      message_count: sql<number>`(
        select count(*)::int from ${chatMessages} where ${chatMessages.session_id} = ${supportTickets.session_id}
      )`,
    })
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.user_id))
    .where(where)
    .orderBy(desc(supportTickets.last_message_at))
    .limit(limit)
    .offset(offset);

  const counted = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(where);

  return { tickets: rows as TicketRow[], total: counted[0]?.n ?? 0 };
}

/** Headline numbers for the admin overview. */
export async function ticketStats() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byStatus, today, response] = await Promise.all([
    db
      .select({ status: supportTickets.status, n: sql<number>`count(*)::int` })
      .from(supportTickets)
      .groupBy(supportTickets.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(supportTickets)
      .where(gte(supportTickets.created_at, dayAgo)),
    db
      .select({
        avgSeconds: sql<number>`coalesce(avg(extract(epoch from (${supportTickets.first_response_at} - ${supportTickets.created_at}))), 0)::int`,
      })
      .from(supportTickets)
      .where(sql`${supportTickets.first_response_at} is not null`),
  ]);

  const counts: Record<string, number> = { open: 0, pending: 0, resolved: 0, closed: 0 };
  for (const row of byStatus) counts[row.status] = row.n;

  return {
    ...counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    last24h: today[0]?.n ?? 0,
    avgFirstResponseSeconds: response[0]?.avgSeconds ?? 0,
  };
}

/** Operator edits. Only the fields an operator is allowed to move. */
export async function updateTicket(
  id: number,
  patch: { status?: string; priority?: string; internal_note?: string; agent?: string },
) {
  const set: Record<string, unknown> = { updated_at: new Date() };

  if (patch.status && TICKET_STATUSES.includes(patch.status as TicketStatus)) {
    set.status = patch.status;
    // resolved_at tracks when work actually stopped, so it is set on the way in
    // and cleared if the ticket is reopened.
    set.resolved_at = patch.status === 'resolved' || patch.status === 'closed' ? new Date() : null;
  }
  if (patch.priority && TICKET_PRIORITIES.includes(patch.priority as TicketPriority)) {
    set.priority = patch.priority;
  }
  if (typeof patch.internal_note === 'string') set.internal_note = patch.internal_note.slice(0, 2000);
  if (typeof patch.agent === 'string') set.agent = patch.agent.slice(0, 32);

  await db.update(supportTickets).set(set).where(eq(supportTickets.id, id));
}
