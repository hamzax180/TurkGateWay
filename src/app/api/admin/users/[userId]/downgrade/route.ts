export const runtime = 'nodejs';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdmin(req);
    const { userId } = await params;
    const [user] = await db.select().from(users).where(eq(users.id, parseInt(userId)));
    if (!user) return Response.json({ detail: 'Not found' }, { status: 404 });

    await db.update(users).set({ subscription_status: 'canceled' }).where(eq(users.id, user.id));
    return Response.json({ status: 'success', user_id: user.id, subscription_status: 'canceled' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
