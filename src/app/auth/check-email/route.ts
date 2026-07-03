export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { sql } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) return Response.json({ detail: 'Email required' }, { status: 400 });

    const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase().trim()}`);

    if (!user) return Response.json({ detail: 'No account found' }, { status: 404 });

    return Response.json({ exists: true });
  } catch {
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
