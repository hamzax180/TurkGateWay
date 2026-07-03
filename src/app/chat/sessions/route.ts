export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { getOptionalUser, requireUser } from '@/lib/user-helper';
import { randomUUID } from 'crypto';

// GET /chat/sessions — list user's sessions
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.user_id, user.id))
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
