export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { sql } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) return Response.json({ detail: 'Email required' }, { status: 400 });

    // Enumeration guard — the login flow calls this before every attempt, so
    // the limit is looser than login's own.
    const { success } = await rateLimit(clientKey(req, String(email)), 20, 60);
    if (!success) {
      return Response.json({ detail: 'Too many attempts. Please try again in a minute.' }, { status: 429 });
    }

    const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase().trim()}`);

    if (!user) return Response.json({ detail: 'No account found' }, { status: 404 });

    return Response.json({ exists: true });
  } catch (e) {
    console.error('[auth/check-email]', e);
    return Response.json(
      { detail: 'Account check unavailable right now. Please try again in a moment.' },
      { status: 503 },
    );
  }
}
