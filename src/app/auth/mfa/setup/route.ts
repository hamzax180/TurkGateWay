export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { generateTotpSecret, totpProvisioningUri } from '@/lib/auth';

/**
 * POST /auth/mfa/setup — begin TOTP enrolment.
 *
 * Generates a secret and stores it WITHOUT enabling it; /auth/mfa/verify
 * confirms the user has a working authenticator before MFA goes live. This
 * is the endpoint the legacy backend had and the Next.js port lost, leaving
 * users unable to enable the second factor the login route now enforces.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    if (user.mfa_enabled) {
      return Response.json({ detail: 'MFA is already enabled' }, { status: 400 });
    }

    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ mfa_secret: secret, mfa_enabled: false })
      .where(eq(users.id, user.id));

    return Response.json({
      secret,
      provisioning_uri: totpProvisioningUri(secret, user.email),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
