export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await requireUser(req);
    const { sessionId } = await params;

    const [session] = await db.select().from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)));

    if (!session) return Response.json({ detail: 'Not found' }, { status: 404 });

    await db.update(chatSessions)
      .set({ is_favorite: !session.is_favorite })
      .where(eq(chatSessions.id, sessionId));

    return Response.json({ is_favorite: !session.is_favorite });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
