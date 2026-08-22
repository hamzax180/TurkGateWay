export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { chatSessions } from '@/lib/schema';
import { getOptionalUser, requireUser } from '@/lib/user-helper';
import {
  getChecklistStatus,
  removeChecklistDocument,
  uploadChecklistDocument,
} from '@/lib/checklist-status';
import { checkEntitlement, entitlementResponse } from '@/lib/entitlements';

/**
 * Only the university registration checklist is sold. Denklik and dormitory
 * share its application record but are standalone advice, and the visa and
 * İkamet lists are public. The entitlement itself lives in entitlements.ts —
 * this only decides which requests need asking about.
 */
function featureFor(serviceId: string) {
  return serviceId === 'university_registration' ? ('university_checklist' as const) : null;
}

/**
 * A session belongs to whoever created it. Documents here are passports and
 * bank statements, so reading or writing one requires owning the conversation,
 * not merely knowing its id.
 */
async function assertOwnsSession(sessionId: string, userId: number) {
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, userId)))
    .limit(1);
  return Boolean(session);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const service = url.searchParams.get('service');
    const lang = url.searchParams.get('lang') ?? 'en';

    if (!sessionId || !service) {
      return Response.json({ detail: 'session_id and service required' }, { status: 400 });
    }

    const user = await getOptionalUser(req);
    const owns = Boolean(user && (await assertOwnsSession(sessionId, user.id)));

    const feature = featureFor(service);
    if (feature) {
      const gate = await checkEntitlement({ feature, sessionId, ownsSession: owns });
      if (!gate.allowed) return entitlementResponse(gate);
    }

    // Reading a checklist before signing in is normal — the list itself is
    // public advice. Without an account there is simply nothing uploaded yet.
    if (!owns) {
      const status = await getChecklistStatus({ sessionId: '', serviceId: service, lang });
      return status
        ? Response.json({ status })
        : Response.json({ detail: 'Unknown service' }, { status: 404 });
    }

    const status = await getChecklistStatus({ sessionId, serviceId: service, lang });
    if (!status) return Response.json({ detail: 'Unknown service' }, { status: 404 });
    return Response.json({ status });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[checklist GET]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();

    const sessionId = String(form.get('session_id') ?? '');
    const service = String(form.get('service') ?? '');
    const itemKey = String(form.get('item_key') ?? '');
    const lang = String(form.get('lang') ?? 'en');
    const file = form.get('file');

    if (!sessionId || !service || !itemKey) {
      return Response.json({ detail: 'session_id, service and item_key required' }, { status: 400 });
    }
    // Uploading into a checklist that has not been paid for would hand over
    // the storage and the processing the credit is meant to cover.
    if (featureFor(service)) {
      const gate = await checkEntitlement({ feature: 'university_uploads', sessionId });
      if (!gate.allowed) return entitlementResponse(gate);
    }

    if (!(file instanceof File)) {
      return Response.json({ detail: 'No file attached.' }, { status: 400 });
    }
    if (!(await assertOwnsSession(sessionId, user.id))) {
      return Response.json({ detail: 'Not your conversation.' }, { status: 403 });
    }

    const result = await uploadChecklistDocument({
      sessionId,
      userId: user.id,
      serviceId: service,
      itemKey,
      lang,
      file,
    });

    if (!result.ok) return Response.json({ detail: result.reason }, { status: 400 });
    return Response.json({ status: result.status });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const service = url.searchParams.get('service');
    const itemKey = url.searchParams.get('item');
    const lang = url.searchParams.get('lang') ?? 'en';

    if (!sessionId || !service || !itemKey) {
      return Response.json({ detail: 'session_id, service and item required' }, { status: 400 });
    }
    if (!(await assertOwnsSession(sessionId, user.id))) {
      return Response.json({ detail: 'Not your conversation.' }, { status: 403 });
    }

    const status = await removeChecklistDocument({ sessionId, serviceId: service, itemKey, lang });
    if (!status) return Response.json({ detail: 'Unknown service' }, { status: 404 });
    return Response.json({ status });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
