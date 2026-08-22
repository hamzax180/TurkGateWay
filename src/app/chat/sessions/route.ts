export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq, desc, and, or, ne, isNull } from 'drizzle-orm';
import { getOptionalUser, requireUser } from '@/lib/user-helper';
import { randomUUID } from 'crypto';

/**
 * GET /chat/sessions — list the user's sessions.
 *
 * `?assistant_type=student` returns only that agent's chats. This matters for
 * more than tidiness: the limit below is applied by the database, so filtering
 * in the browser afterwards meant a user with more than 100 sessions could
 * lose an entire agent's history off the end of the list — the rows were never
 * sent, so no amount of client-side filtering could bring them back. Asking
 * per agent gives each one its own 100.
 *
 * With no parameter, customer-service transcripts are excluded: they belong to
 * the tickets UI, not the agent sidebar, and there is no reason to ship them
 * to the chat client at all.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const assistantType = new URL(req.url).searchParams.get('assistant_type');

    // Rows written before the column was set consistently are permit chats.
    const typeFilter = assistantType
      ? assistantType === 'permit'
        ? or(eq(chatSessions.assistant_type, 'permit'), isNull(chatSessions.assistant_type))
        : eq(chatSessions.assistant_type, assistantType)
      : or(ne(chatSessions.assistant_type, 'support'), isNull(chatSessions.assistant_type));

    const sessions = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.user_id, user.id), typeFilter))
      .orderBy(desc(chatSessions.updated_at))
      .limit(100);
    return Response.json(sessions);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

// POST /chat/sessions — create new session
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const assistantType = url.searchParams.get('assistant_type') ?? 'permit';

    const [session] = await db.insert(chatSessions).values({
      id: randomUUID(),
      user_id: user.id,
      assistant_type: assistantType,
      language: 'en',
    }).returning();

    return Response.json(session);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
