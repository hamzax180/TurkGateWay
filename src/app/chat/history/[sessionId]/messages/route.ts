export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatMessages, chatSessions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { requireUser } from '@/lib/user-helper';
import { z } from 'zod';

const schema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  service: z.string().optional(),
  flow_type: z.string().optional(),
  dashboard_state: z.record(z.string(), z.unknown()).optional(),
});

// POST /chat/history/[sessionId]/messages — batch save messages
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await requireUser(req);
    const { sessionId } = await params;
    const body = await req.json();
    const { messages, service, flow_type, dashboard_state } = schema.parse(body);

    // Insert messages
    if (messages.length > 0) {
      await db.insert(chatMessages).values(
        messages.map(m => ({
          session_id: sessionId,
          role: m.role,
          content: m.content,
        })),
      );
    }

    // Update session metadata
    const updates: Record<string, unknown> = { updated_at: new Date() };

    // Auto-generate title from first user message
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
    if (session && !session.title) {
      const firstUser = messages.find(m => m.role === 'user');
      if (firstUser) {
        const title = service ?? (firstUser.content.length > 50
          ? firstUser.content.slice(0, 47) + '...'
          : firstUser.content);
        updates.title = title;
      }
    }

    if (service) {
      updates.service_id = `${session?.assistant_type ?? 'permit'}:${service.toLowerCase().replace(/\s+/g, '_')}`;
    }

    if (dashboard_state) {
      updates.dashboard_state = JSON.stringify(dashboard_state);
    }

    await db.update(chatSessions).set(updates).where(eq(chatSessions.id, sessionId));

    const [updated] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));

    return Response.json({ status: 'saved', session_title: updated?.title ?? null });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
