export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    const body = form
      ? Object.fromEntries(form.entries())
      : await req.json().catch(() => ({}));

    const token = body.token as string;
    const status = body.status as string;

    if (status === 'success' && token) {
      // Verify with iyzipay and extract user info from conversationId
      const conversationId = body.conversationId as string ?? '';
      const userIdMatch = conversationId.match(/^tg-(\d+)-/);
      if (userIdMatch) {
        const userId = parseInt(userIdMatch[1]);
        await db.update(users).set({
          subscription_status: 'active',
          subscription_reference_code: token,
          token_balance: 100,
          last_token_reset: new Date(),
        }).where(eq(users.id, userId));
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const redirectUrl = status === 'success'
      ? `${appUrl}/dashboard?payment=success`
      : `${appUrl}/pricing?payment=failed`;

    return Response.redirect(redirectUrl, 302);
  } catch {
    return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/pricing`, 302);
  }
}

export async function GET(req: Request) {
  return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/pricing`, 302);
}
