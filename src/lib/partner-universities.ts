import { db } from './db';
import { universityPartners } from './schema';
import { eq } from 'drizzle-orm';

/**
 * The partner university registry — who we can actually place students with,
 * and what each placement earns.
 *
 * Commission is only collectable where a representation agreement exists — a
 * university with no agreement has nobody to invoice — so every entry must
 * carry agreementRef; a row without one is a rate that cannot be enforced.
 * The `university_partners` table is the live copy this module syncs into;
 * `application_submissions` rows reference partner ids, so the sync
 * deactivates removed partners instead of deleting them.
 */

export type PartnerUniversityEntry = {
  name: string;
  city?: string;
  /** Where applications are actually sent — portal URL or admissions address. */
  applyVia?: string;
  /** Commission as basis points of first-year tuition (1200 = 12%). */
  commissionBps?: number;
  /** Or a flat fee per enrolment, where the agreement works that way. */
  commissionFlatMinor?: number;
  currency?: 'USD' | 'EUR' | 'TRY';
  /** The signed agreement this rate comes from. No reference, no invoice. */
  agreementRef?: string;
  notes?: string;
};

/**
 * PLACEHOLDER — empty until the real partner names and commission terms land.
 * Every entry must include agreementRef; commission is either commissionBps
 * or commissionFlatMinor, never both.
 */
export const PARTNER_UNIVERSITIES: PartnerUniversityEntry[] = [];

/** What is currently in the registry, for the placement team and the chat. */
export async function listPartnerUniversities(activeOnly = true) {
  const rows = activeOnly
    ? await db.select().from(universityPartners).where(eq(universityPartners.active, true))
    : await db.select().from(universityPartners);
  return rows;
}

/**
 * Push the registry into `university_partners`, idempotently: an entry whose
 * name already exists is refreshed in place, new names are inserted, and
 * entries absent from the list are deactivated rather than deleted so
 * `application_submissions` keeps its foreign keys.
 */
export async function syncPartnerRegistry(
  entries: PartnerUniversityEntry[] = PARTNER_UNIVERSITIES,
) {
  const existing = await db.select().from(universityPartners);
  const byName = new Map(existing.map((row) => [row.name, row]));

  let inserted = 0;
  let updated = 0;
  let deactivated = 0;

  for (const entry of entries) {
    const row = byName.get(entry.name);
    const values = {
      name: entry.name,
      city: entry.city ?? null,
      apply_via: entry.applyVia ?? null,
      commission_bps: entry.commissionBps ?? null,
      commission_flat_minor: entry.commissionFlatMinor ?? null,
      currency: entry.currency ?? 'USD',
      agreement_ref: entry.agreementRef ?? null,
      notes: entry.notes ?? null,
      active: true,
    };
    if (row) {
      await db.update(universityPartners).set(values).where(eq(universityPartners.id, row.id));
      updated++;
    } else {
      await db.insert(universityPartners).values(values);
      inserted++;
    }
    byName.delete(entry.name);
  }

  for (const stale of byName.values()) {
    if (stale.active) {
      await db
        .update(universityPartners)
        .set({ active: false })
        .where(eq(universityPartners.id, stale.id));
      deactivated++;
    }
  }

  return { inserted, updated, deactivated };
}
