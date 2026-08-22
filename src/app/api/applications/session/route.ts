export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { applications, chatSessions } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { CHECKLIST_APPLICATION_KIND, checklistById, checklistView, pickLang } from '@/lib/document-checklists';
import { checkEntitlement } from '@/lib/entitlements';

/**
 * GET /api/applications/session?session_id=&lang=
 *
 * Which document checklists belong to a conversation.
 *
 * The card used to live only in the React state written while the reply was
 * streaming, so reopening a conversation lost it: the applicant saw the prose
 * list of documents with no way to upload against it, and no sign of the files
 * they had already sent. The applications table already knows which services a
 * session started, so the card can be rebuilt from it on load.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const lang = url.searchParams.get('lang') ?? 'en';
    if (!sessionId) return Response.json({ detail: 'session_id required' }, { status: 400 });

    const [session] = await db
      .select({ id: chatSessions.id, service_id: chatSessions.service_id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)))
      .limit(1);
    if (!session) return Response.json({ services: [] });

    const rows = await db
      .select({ kind: applications.kind })
      .from(applications)
      .where(eq(applications.session_id, sessionId));

    const kinds = new Set(rows.map((r) => r.kind));
    const pick = pickLang(lang);

    // The university checklist is the paid product, so it is withheld here for
    // the same reason it is withheld from the checklist endpoint.
    //
    // This route rebuilds the card when a conversation is reopened, which
    // includes the browser's back button restoring a cached page. Without the
    // check, leaving for the pricing page and pressing Back handed over the
    // full document list — the paywall held in the conversation but not in the
    // reload path, so it could be walked around in two clicks.
    const universityGate = await checkEntitlement({
      feature: 'university_checklist',
      sessionId,
    });
    const paidForUniversity = universityGate.allowed;
    const withheld = (checklistId: string) =>
      checklistId === 'university_registration' && !paidForUniversity;

    // The service the agent last listed documents for. An application row only
    // appears once something is uploaded, so without this a conversation that
    // showed the checklist but has no files yet would rebuild nothing.
    const lastService = session.service_id ? checklistById(session.service_id) : null;
    if (lastService && withheld(lastService.id)) return Response.json({ services: [] });
    if (lastService && !kinds.has(CHECKLIST_APPLICATION_KIND[lastService.id])) {
      return Response.json({
        services: [
          {
            service: lastService.id,
            agent: lastService.agent,
            items: checklistView(lastService, pick),
          },
        ],
      });
    }

    // An application kind can come from more than one checklist (Denklik and
    // dormitory both file under `university`); take the first that matches so a
    // session shows one card per application, not one per alias.
    const seen = new Set<string>();
    const services = [];
    for (const [checklistId, kind] of Object.entries(CHECKLIST_APPLICATION_KIND)) {
      if (!kinds.has(kind) || seen.has(kind)) continue;
      if (withheld(checklistId)) continue;
      const checklist = checklistById(checklistId);
      if (!checklist) continue;
      seen.add(kind);
      services.push({
        service: checklist.id,
        agent: checklist.agent,
        items: checklistView(checklist, pick),
      });
    }

    return Response.json({ services });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
