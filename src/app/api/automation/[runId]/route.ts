export const runtime = 'nodejs';
export const maxDuration = 60;

import { requireUser } from '@/lib/user-helper';
import {
  describeRun,
  forwardClick,
  forwardKey,
  forwardType,
  getRun,
  latestFrame,
  stopRun,
  touchRun,
} from '@/lib/browser-automation';

/**
 * The applicant's window onto the automation.
 *
 * GET    — the latest frame plus status and log
 * POST   — forward one of their clicks / keystrokes to the real page
 * DELETE — close the browser
 *
 * Polling rather than a socket: the frame is a whole JPEG each time, the page
 * changes about once a second, and a poll survives the reconnects that a long
 * -lived stream through a dev server does not.
 */

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireUser(req);
    const { runId } = await ctx.params;
    const run = getRun(runId, user.id);
    if (!run) return Response.json({ detail: 'No such automation.' }, { status: 404 });

    touchRun(run);
    const url = new URL(req.url);
    // The client tells us which frame it already has, so an unchanged page
    // does not re-send 200KB of identical JPEG every second.
    const since = Number(url.searchParams.get('since') ?? 0);
    const frameAt = run.frameAt;
    const send = frameAt > since;

    return Response.json({
      ...describeRun(run),
      frame: send ? latestFrame(run) : null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireUser(req);
    const { runId } = await ctx.params;
    const run = getRun(runId, user.id);
    if (!run) return Response.json({ detail: 'No such automation.' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const type = String(body?.type ?? '');

    // Everything here originates from the applicant acting on the picture.
    // The automation itself never reaches these paths.
    if (type === 'click') {
      await forwardClick(run, Number(body?.x ?? 0), Number(body?.y ?? 0));
    } else if (type === 'type') {
      await forwardType(run, String(body?.text ?? ''));
    } else if (type === 'key') {
      await forwardKey(run, String(body?.key ?? ''));
    } else {
      return Response.json({ detail: 'Unknown action.' }, { status: 400 });
    }

    return Response.json({ ok: true, ...describeRun(run) });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const user = await requireUser(req);
    const { runId } = await ctx.params;
    const stopped = await stopRun(runId, user.id);
    return Response.json({ ok: stopped });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
