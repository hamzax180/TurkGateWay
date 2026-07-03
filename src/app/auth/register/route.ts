export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { hashPassword, signToken } from '@/lib/auth';
import { tokenPayload } from '@/lib/user-helper';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    const email = parsed.email.toLowerCase().trim();
    const { password, full_name } = parsed;

    // Case-insensitive duplicate check so the same email can't register twice with different casing
    const existing = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (existing.length > 0) {
      return Response.json({ detail: 'Email already registered' }, { status: 400 });
    }

    const hashed = await hashPassword(password);
    const [user] = await db.insert(users).values({
      email,
      hashed_password: hashed,
      full_name: full_name ?? null,
      subscription_status: 'free',
      token_balance: 25,
      last_token_reset: new Date(),
    }).returning();

    const access_token = await signToken({ sub: String(user.id), email: user.email });

    return Response.json({
      access_token,
      token_type: 'bearer',
      ...tokenPayload(user),
    });
  } catch (e: any) {
    if (e?.name === 'ZodError') return Response.json({ detail: 'Invalid input' }, { status: 422 });
    return Response.json({ detail: 'Registration failed' }, { status: 500 });
  }
}
