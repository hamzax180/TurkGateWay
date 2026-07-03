export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const all = await db.select({
      id: users.id,
      email: users.email,
      full_name: users.full_name,
      subscription_status: users.subscription_status,
      subscription_reference_code: users.subscription_reference_code,
      token_balance: users.token_balance,
      is_admin: users.is_admin,
    }).from(users);
    return Response.json(all);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
