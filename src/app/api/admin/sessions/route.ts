export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions, chatMessages, users } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { eq, count, desc, ilike, or } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const skip = parseInt(url.searchParams.get('skip') ?? '0');
    const limit = parseInt(url.searchParams.get('limit') ?? '30');
    const assistantType = url.searchParams.get('assistant_type');
    const search = url.searchParams.get('search');

    // Base query with user join
    let rows = await db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        assistant_type: chatSessions.assistant_type,
        service_id: chatSessions.service_id,
        service_slots: chatSessions.service_slots,
        created_at: chatSessions.created_at,
        updated_at: chatSessions.updated_at,
        is_favorite: chatSessions.is_favorite,
        user_id: chatSessions.user_id,
        user_email: users.email,
        user_name: users.full_name,
        user_status: users.subscription_status,
      })
      .from(chatSessions)
      .leftJoin(users, eq(chatSessions.user_id, users.id))
      .orderBy(desc(chatSessions.updated_at))
      .limit(200); // fetch more then filter in JS for simplicity

    if (assistantType) rows = rows.filter(r => r.assistant_type === assistantType);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.title?.toLowerCase().includes(q) ||
        r.user_email?.toLowerCase().includes(q) ||
        r.user_name?.toLowerCase().includes(q),
      );
    }

    const total = rows.length;
    const paged = rows.slice(skip, skip + limit);

    // Get message counts
    const sessionIds = paged.map(r => r.id);
    const sessions = await Promise.all(
      paged.map(async r => {
        const [{ msg_count }] = await db
          .select({ msg_count: count() })
          .from(chatMessages)
          .where(eq(chatMessages.session_id, r.id));
        return {
          ...r,
          service_slots: r.service_slots ? JSON.parse(r.service_slots) : null,
          message_count: msg_count,
          user: r.user_email ? { id: r.user_id, email: r.user_email, full_name: r.user_name, subscription_status: r.user_status } : null,
        };
      }),
    );

    return Response.json({ sessions, total });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
