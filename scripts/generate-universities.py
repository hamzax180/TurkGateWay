#!/usr/bin/env python3
"""
Regenerates src/lib/turkish-universities.ts from the outreach workbook.

The agent suggests universities from this list, so it must stay in step with
universities/turkey_private_university_emails.xlsx. Run after editing that file:

    python scripts/generate-universities.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required:  python -m pip install openpyxl")

REPO = Path(__file__).resolve().parent.parent
WORKBOOK = REPO / "universities" / "turkey_private_university_emails.xlsx"
SHEET = "Private Universities - Turkey"
OUT = REPO / "src" / "lib" / "turkish-universities.ts"

HEADER = '''/**
 * Private (vakıf / foundation) universities in Türkiye.
 *
 * GENERATED FILE — do not edit by hand.
 * Source: universities/turkey_private_university_emails.xlsx
 * Regenerate: python scripts/generate-universities.py
 *
 * Only facts that came from the universities' own sites are here: name, city,
 * website, and the admissions contact. Tuition figures and GPA thresholds are
 * deliberately absent — we do not hold verified numbers for them, and inventing
 * an entry requirement a student then plans around would be worse than saying
 * we need to check. `emailStatus` says whether the contact address was read off
 * the site ('confirmed') or inferred from that site's own address pattern
 * ('inferred'); never auto-send to an inferred address without checking it.
 */

export type TurkishUniversity = {
  name: string;
  city: string;
  website: string;
  /** Admissions / international office contact. Server-side use only. */
  email: string;
  emailStatus: 'confirmed' | 'inferred';
  /** Which office the address belongs to, e.g. "International Admissions". */
  office: string;
};

export const TURKISH_UNIVERSITIES: TurkishUniversity[] = [
'''

FOOTER = '''];

/** Distinct cities, most universities first — used to offer real choices. */
export function universityCities(): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const u of TURKISH_UNIVERSITIES) {
    counts.set(u.city, (counts.get(u.city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

/** Case- and diacritic-insensitive match, so "gelisim" finds "Gelişim". */
function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves what the student typed to a university on the list.
 * Returns null rather than a near-miss: registering the wrong university is
 * far worse than asking them to confirm which one they meant.
 */
export function findUniversity(input: string): TurkishUniversity | null {
  const q = fold(input);
  if (q.length < 3) return null;

  const exact = TURKISH_UNIVERSITIES.find((u) => fold(u.name) === q);
  if (exact) return exact;

  const hits = TURKISH_UNIVERSITIES.filter((u) => {
    const name = fold(u.name);
    return name.includes(q) || q.includes(fold(u.name.split(' ')[0]));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Every university whose name contains the query, for "did you mean" lists. */
export function searchUniversities(input: string, limit = 8): TurkishUniversity[] {
  const q = fold(input);
  if (q.length < 2) return [];
  return TURKISH_UNIVERSITIES.filter((u) => fold(u.name).includes(q)).slice(0, limit);
}

/** Universities in a city, for suggestions. Empty when the city is unknown. */
export function universitiesInCity(city: string, limit = 10): TurkishUniversity[] {
  const q = fold(city);
  if (!q) return [];
  return TURKISH_UNIVERSITIES.filter((u) => fold(u.city) === q).slice(0, limit);
}
'''


def esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def main() -> None:
    wb = openpyxl.load_workbook(WORKBOOK, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    header = [str(c or "").strip().lower() for c in rows[0]]
    idx = {name: header.index(name) for name in header}

    def cell(row, *names: str) -> str:
        for name in names:
            i = idx.get(name)
            if i is not None and i < len(row) and row[i]:
                return str(row[i]).strip()
        return ""

    entries = []
    for row in rows[1:]:
        if not row or not any(row):
            continue
        name = cell(row, "university", "name")
        email = cell(row, "best contact email", "contact email", "email")
        if not name or not email:
            continue
        status = "confirmed" if "confirmed" in cell(row, "status").lower() else "inferred"
        entries.append(
            "  { name: '%s', city: '%s', website: '%s', email: '%s', emailStatus: '%s', office: '%s' },"
            % (
                esc(name),
                esc(cell(row, "city")),
                esc(cell(row, "website", "url")),
                esc(email),
                status,
                esc(cell(row, "department / office", "department", "office") or "General"),
            )
        )

    entries.sort()
    OUT.write_text(HEADER + "\n".join(entries) + "\n" + FOOTER, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(REPO)} — {len(entries)} universities")


if __name__ == "__main__":
    main()
