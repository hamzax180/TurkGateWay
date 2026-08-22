export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users, chatSessions, purchases, serviceCredits, familyInvites, creditLedger } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { hashPassword } from '@/lib/auth';
import { randomBytes } from 'crypto';

/**
 * DELETE /auth/account — erase the user's account.
 *
 * Personal content (chat sessions, which cascade to messages, applications
 * and their documents) is deleted outright. The user row itself is deleted
 * only when no financial records reference it — purchases, credits, family
 * invites and the credit ledger all hold foreign keys to users, and deleting
 * a paying user's row would break the audit trail (and throw a FK error).
 * In that case the row is anonymized instead: identity fields are destroyed
 * and the account is deactivated, which is the same effect for the user.
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);

    await db.delete(chatSessions).where(eq(chatSessions.user_id, user.id));

    const [purchase] = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.user_id, user.id)).limit(1);
    const [credit] = await db.select({ id: serviceCredits.id }).from(serviceCredits).where(eq(serviceCredits.owner_user_id, user.id)).limit(1);
    const [invite] = await db.select({ id: familyInvites.id }).from(familyInvites).where(eq(familyInvites.inviter_user_id, user.id)).limit(1);
    const [inviteAccepted] = await db.select({ id: familyInvites.id }).from(familyInvites).where(eq(familyInvites.accepted_user_id, user.id)).limit(1);
    const [ledger] = await db.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.user_id, user.id)).limit(1);

    const hasFinancialRecords = Boolean(purchase || credit || invite || inviteAccepted || ledger);

    if (hasFinancialRecords) {
      await db
        .update(users)
        .set({
          email: `deleted-${user.id}-${Date.now()}@anon.invalid`,
          hashed_password: await hashPassword(randomBytes(24).toString('hex')),
          full_name: null,
          is_active: false,
          latest_dashboard_state: null,
          subscription_reference_code: null,
          api_key: null,
          mfa_secret: null,
          mfa_enabled: false,
        })
        .where(eq(users.id, user.id));
    } else {
      await db.delete(users).where(eq(users.id, user.id));
    }

    return Response.json({ status: 'deleted' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
