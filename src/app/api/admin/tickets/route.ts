export const runtime = 'nodejs';

import { requireAdmin } from '@/lib/user-helper';
import { listTickets, ticketStats } from '@/lib/support-tickets';

/**
 * GET /api/admin/tickets?status=&priority=&search=&skip=&limit=
 * The operator queue: every customer service contact, newest activity first,
 * plus the headline counts the overview tab shows.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const { tickets, total } = await listTickets({
      status: url.searchParams.get('status') ?? 'all',
      priority: url.searchParams.get('priority') ?? 'all',
      search: url.searchParams.get('search') ?? undefined,
      limit: parseInt(url.searchParams.get('limit') ?? '25'),
      offset: parseInt(url.searchParams.get('skip') ?? '0'),
    });

    const stats = await ticketStats();
    return Response.json({ tickets, total, stats });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
