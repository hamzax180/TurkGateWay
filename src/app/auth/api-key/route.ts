export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { randomBytes } from 'crypto';

// GET /auth/api-key — get current API key
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({ api_key: user.api_key ?? null });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

// POST /auth/api-key/generate — generate new API key
// (also handles POST /auth/api-key for compatibility)
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const newKey = `tg-${randomBytes(24).toString('hex')}`;
    await db.update(users).set({ api_key: newKey }).where(eq(users.id, user.id));
    return Response.json({ api_key: newKey });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

// DELETE /auth/api-key — revoke API key
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    await db.update(users).set({ api_key: null }).where(eq(users.id, user.id));
    return Response.json({ status: 'revoked' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
