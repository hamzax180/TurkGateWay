export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { applications, chatSessions } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { applicationKindFor } from '@/lib/checklist-status';
import { parseStoredData } from '@/lib/intake-core';
import { countryWithDiallingCode, fieldsForKind, normalizePhone } from '@/lib/document-extract';

/**
 * POST /api/applications/details
 * Body: { session_id, service, values: { [fieldKey]: string } }
 *
 * Fill in details the documents did not contain.
 *
 * Not everything on a visa form is printed on a document — an email address,
 * a phone number and a planned travel date exist nowhere in a passport or a
 * bank statement. Without this the applicant reached a card that said what was
 * missing and gave them no way to supply it, which is a dead end.
 *
 * Values typed here are authoritative: unlike extraction, which never
 * overwrites, a person correcting their own details is the best source there
 * is.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);

    const sessionId = String(body?.session_id ?? '');
    const service = String(body?.service ?? '');
    const values = body?.values;

    if (!sessionId || !service || !values || typeof values !== 'object') {
      return Response.json({ detail: 'session_id, service and values required' }, { status: 400 });
    }

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)))
      .limit(1);
    if (!session) return Response.json({ detail: 'Not your conversation.' }, { status: 403 });

    const kind = applicationKindFor(service);
    if (!kind) return Response.json({ detail: 'Unknown service' }, { status: 404 });

    const fields = fieldsForKind(kind);
    if (!fields.length) return Response.json({ detail: 'That service has no form fields.' }, { status: 400 });

    const [application] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.session_id, sessionId), eq(applications.kind, kind)))
      .limit(1);
    if (!application) return Response.json({ detail: 'No application yet.' }, { status: 404 });

    const merged = parseStoredData(application.data);
    // Only keys this service actually defines — a crafted body must not be
    // able to write arbitrary junk into an application.
    const allowed = new Map(fields.map((f) => [f.key, f]));

    for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      if (typeof raw !== 'string') continue;
      let value = raw.trim().slice(0, 200);
      // Same normalisation extraction applies, so a number typed with spaces
      // is not rejected by the appointment form as invalid.
      if (/phone|mobile|tel/i.test(key)) {
        // Use the country already on file so a locally-written number gains its
        // dialling code instead of being stored in a form the site rejects.
        value = normalizePhone(
          value,
          countryWithDiallingCode([merged.applicationCountry, merged.nationality]),
        );
      }
      if (value) merged[key] = value;
    }

    const missing = fields.filter((f) => !f.optional && !String(merged[f.key] ?? '').trim());

    const locked = new Set(['submitted', 'booked', 'forwarded', 'done']);
    const nextStatus = locked.has(application.status)
      ? application.status
      : missing.length === 0
        ? 'ready'
        : application.status;

    await db
      .update(applications)
      .set({ data: JSON.stringify(merged), status: nextStatus, updated_at: new Date() })
      .where(eq(applications.id, application.id));

    return Response.json({
      ok: true,
      missing: missing.map((f) => ({ key: f.key, label: f.short })),
      status: nextStatus,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
