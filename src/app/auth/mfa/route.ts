export const runtime = 'nodejs';

import { requireUser } from '@/lib/user-helper';

/**
 * GET /auth/mfa — current two-factor state, for the settings page.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({ mfa_enabled: user.mfa_enabled === true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
