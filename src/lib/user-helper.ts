import { db } from './db';
import { users } from './schema';
import { eq } from 'drizzle-orm';
import { verifyToken, extractToken } from './auth';

/** Returns the authenticated user or null (for optional-auth routes). */
export async function getOptionalUser(req: Request) {
  const token = extractToken(req);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.sub) return null;
  const [user] = await db.select().from(users).where(eq(users.id, Number(payload.sub)));
  return user ?? null;
}

/** Returns the authenticated user or throws 401. */
export async function requireUser(req: Request) {
  const user = await getOptionalUser(req);
  if (!user) throw new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401 });
  return user;
}

/** Returns admin user or throws 403. */
export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  if (!user.is_admin) throw new Response(JSON.stringify({ detail: 'Not authorized' }), { status: 403 });
  return user;
}

/** Build the token payload returned to the frontend. */
export function tokenPayload(user: typeof users.$inferSelect) {
  return {
    email: user.email,
    full_name: user.full_name ?? '',
    is_admin: user.is_admin ?? false,
    token_balance: user.token_balance ?? 25,
    subscription_status: user.subscription_status ?? 'free',
    last_token_reset: user.last_token_reset?.toISOString() ?? null,
  };
}

/** Check and reset token balance based on subscription tier. */
export function shouldResetTokens(user: typeof users.$inferSelect): boolean {
  if (!user.last_token_reset) return true;
  const now = Date.now();
  const last = new Date(user.last_token_reset).getTime();
  const isActive = user.subscription_status === 'active';
  const windowMs = isActive ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  return now - last > windowMs;
}

export function defaultTokens(user: typeof users.$inferSelect) {
  return user.subscription_status === 'active' ? 100 : 25;
}
