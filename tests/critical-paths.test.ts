/**
 * critical-paths.test.ts
 *
 * The repository had no tests. This covers the logic where a silent regression
 * costs money, grants access, or bills the account — not everything, just the
 * parts that are expensive to get wrong and cheap to pin.
 *
 * Deliberately dependency-free: Node's built-in runner and `tsx`, both already
 * present. Every function under test here is pure, so there is no database, no
 * network and no fixture to keep in sync.
 *
 *   npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { totpCodeAt, verifyTotp, generateTotpSecret } from '../src/lib/auth';
import { toMinorUnits } from '../src/lib/iyzico';
import { policyFor, TIERS } from '../src/lib/rate-limit-policy';
import { PLANS, isPlanId } from '../src/lib/plans';
import { DOCUMENT_KIND_MAP, documentSlotFor, toAssistantApplicant } from '../src/lib/ikamet-applicant';
import { checklistById, itemKey } from '../src/lib/document-checklists';
import nextConfig from '../next.config';

// ---------------------------------------------------------------------------
// TOTP — RFC 6238
//
// auth.ts says totpCodeAt is "exported so tests can hit RFC 6238 vectors".
// This is that test. The implementation is hand-rolled to stay compatible with
// secrets the legacy pyotp backend wrote, so it has to match the spec exactly
// rather than merely be self-consistent.
// ---------------------------------------------------------------------------

describe('TOTP (RFC 6238)', () => {
  // ASCII "12345678901234567890", the RFC's SHA-1 seed, base32-encoded.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  // The RFC publishes 8-digit codes; this implementation emits 6, so the
  // expectation is the low 6 digits of each published value.
  const vectors: Array<[seconds: number, code: string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  for (const [seconds, expected] of vectors) {
    test(`T=${seconds} yields ${expected}`, () => {
      assert.equal(totpCodeAt(RFC_SECRET, seconds * 1000), expected);
    });
  }

  test('rejects anything that is not six digits', () => {
    // Shape is checked before the comparison, so these must not even reach it.
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '12345a']) {
      assert.equal(verifyTotp(RFC_SECRET, bad), false, `accepted ${JSON.stringify(bad)}`);
    }
  });

  test('accepts the neighbouring window but not a distant one', () => {
    const now = Date.now();
    const current = totpCodeAt(RFC_SECRET, now)!;
    assert.equal(verifyTotp(RFC_SECRET, current), true);

    // One step back is inside the ±1 window pyotp also allowed.
    const previous = totpCodeAt(RFC_SECRET, now - 30_000)!;
    assert.equal(verifyTotp(RFC_SECRET, previous), true);

    // Ten minutes ago is not. Guard against the vanishingly unlikely case of
    // the two codes colliding, which would make the assertion meaningless.
    const stale = totpCodeAt(RFC_SECRET, now - 600_000)!;
    if (stale !== current && stale !== previous) {
      assert.equal(verifyTotp(RFC_SECRET, stale), false);
    }
  });

  test('generated secrets are usable base32 of the requested length', () => {
    const secret = generateTotpSecret();
    assert.match(secret, /^[A-Z2-7]+$/, 'not base32');
    // 20 bytes → 32 base32 characters.
    assert.equal(secret.length, 32);
    assert.equal(verifyTotp(secret, totpCodeAt(secret, Date.now())!), true);
  });
});

// ---------------------------------------------------------------------------
// Money
//
// settlePurchase() rejects a payment whose amount does not match the purchase
// row exactly. That comparison is only as trustworthy as this conversion: a
// float slip here either rejects good payments or accepts underpayments.
// ---------------------------------------------------------------------------

describe('toMinorUnits', () => {
  test('converts the real plan prices exactly', () => {
    assert.equal(toMinorUnits('350.00'), 35000);
    assert.equal(toMinorUnits('945.00'), 94500);
    assert.equal(toMinorUnits('1750.00'), 175000);
  });

  test('two-decimal amounts convert exactly', () => {
    // Every real price is two decimals, and these are the values where naive
    // float maths drifts: 0.1*100 is 10.000000000000002, 0.29*100 is
    // 28.999999999999996. Math.round is what makes both land correctly.
    assert.equal(toMinorUnits('0.1'), 10);
    assert.equal(toMinorUnits('0.29'), 29);
    assert.equal(toMinorUnits('19.99'), 1999);
    assert.equal(toMinorUnits('1234.56'), 123456);
  });

  test('a third decimal rounds to the nearest kuruş, banker-free', () => {
    // Documented, not aspirational: parseFloat('1.005') is 1.00499999999999989,
    // so this rounds DOWN to 100 rather than to the 101 decimal arithmetic
    // would give. Sub-kuruş amounts are not real prices — iyzico quotes two
    // decimals — so this is recorded as known behaviour rather than a defect.
    // It matters only if a third decimal ever reaches the amount comparison.
    assert.equal(toMinorUnits('1.005'), 100);
    assert.equal(toMinorUnits('1.006'), 101);
  });

  test('accepts numbers as well as strings', () => {
    assert.equal(toMinorUnits(350), 35000);
    assert.equal(toMinorUnits(0), 0);
  });

  test('returns null for anything unusable rather than guessing', () => {
    // null is what makes settlePurchase reject; NaN would compare false
    // against every amount, but 0 would silently equal a zero-priced row.
    for (const bad of [undefined, 'abc', '']) {
      assert.equal(toMinorUnits(bad as never), null, `did not reject ${JSON.stringify(bad)}`);
    }
  });

  test('every plan price round-trips through the comparison settle uses', () => {
    for (const plan of Object.values(PLANS)) {
      const asDecimal = (plan.priceTryMinor / 100).toFixed(2);
      assert.equal(
        toMinorUnits(asDecimal),
        plan.priceTryMinor,
        `${plan.id} does not round-trip`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Rate-limit policy
//
// The table's whole promise is that an unmatched route is still metered, and
// that expensive routes are metered tightly. Both are easy to break by
// inserting a broad rule above a narrow one.
// ---------------------------------------------------------------------------

describe('rate-limit policy', () => {
  test('an unknown route still gets a ceiling', () => {
    const tier = policyFor('/api/something-invented-tomorrow', 'POST');
    assert.equal(tier?.name, 'default');
  });

  test('the model endpoint is on the llm tier', () => {
    assert.equal(policyFor('/agent/query', 'POST')?.name, 'llm');
  });

  test('voice is metered as voice, not as default', () => {
    // Regression guard: these fell through to `default` (60/min) while the
    // provider billed per minute of audio.
    assert.equal(policyFor('/api/voice/realtime/session', 'POST')?.name, 'voice');
    assert.equal(policyFor('/api/voice/transcribe', 'POST')?.name, 'voice');
    assert.equal(policyFor('/api/voice/tts', 'POST')?.name, 'voiceTts');
  });

  test('reading a stored transcript is not billed like placing a call', () => {
    assert.equal(policyFor('/api/voice/transcript/42', 'GET')?.name, 'read');
    assert.equal(policyFor('/api/voice/eligibility', 'GET')?.name, 'read');
  });

  test('payment provider callbacks are exempt', () => {
    // A 429 on these loses money: the provider retries the webhook, and the
    // callback is the customer's own browser landing after paying.
    assert.equal(policyFor('/payment/webhook', 'POST'), null);
    assert.equal(policyFor('/payment/callback', 'POST'), null);
  });

  test('the retention cron is exempt so a 429 cannot skip a sweep', () => {
    assert.equal(policyFor('/api/cron/purge', 'POST'), null);
  });

  test('checklist upload is metered by method, not by path alone', () => {
    // POST runs vision extraction; GET/DELETE are ordinary writes.
    assert.equal(policyFor('/api/applications/checklist', 'POST')?.name, 'vision');
    assert.equal(policyFor('/api/applications/checklist', 'DELETE')?.name, 'write');
  });

  test('every tier with a daily cap also has a minute cap', () => {
    for (const tier of Object.values(TIERS)) {
      assert.ok(tier.perMinute > 0, `${tier.name} has no minute ceiling`);
      if ('perDay' in tier && tier.perDay !== undefined) {
        assert.ok(
          tier.perDay >= tier.perMinute,
          `${tier.name}: daily cap below the minute cap makes the minute cap dead`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Plans
//
// grantCreditsForPurchase() computes what the buyer keeps as
// `credits - invitableSeats`. A plan where that goes negative would mint
// credits owned by nobody and strand the buyer's own purchase.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Security headers
//
// These are set once in next.config.ts and never thought about again, which is
// exactly how one goes missing during an unrelated edit.
// ---------------------------------------------------------------------------

describe('security headers', () => {
  const headersFor = async (source: string) => {
    const groups = await nextConfig.headers!();
    const group = groups.find((g) => g.source === source);
    assert.ok(group, `no header group for ${source}`);
    return new Map(group.headers.map((h) => [h.key, h.value]));
  };

  test('the baseline set is applied to every path', async () => {
    const h = await headersFor('/:path*');
    assert.equal(h.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(h.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.match(h.get('Strict-Transport-Security')!, /max-age=\d+/);
    assert.ok(h.get('Permissions-Policy')?.includes('camera=()'));
  });

  test('framing is SAMEORIGIN, not DENY', async () => {
    // DENY also forbids same-origin framing, which breaks 3D Secure card
    // challenges that post back to a merchant URL inside an iframe. Checkout
    // is the one flow that must not break, so this value is load-bearing.
    const h = await headersFor('/:path*');
    assert.equal(h.get('X-Frame-Options'), 'SAMEORIGIN');
  });

  test('API responses are never cached', async () => {
    const h = await headersFor('/api/:path*');
    assert.equal(h.get('Cache-Control'), 'no-store');
  });
});

describe('plan catalogue', () => {
  test('a buyer always keeps at least one credit', () => {
    for (const plan of Object.values(PLANS)) {
      const keptByBuyer = plan.credits - plan.invitableSeats;
      assert.ok(
        keptByBuyer >= 1,
        `${plan.id}: buyer keeps ${keptByBuyer} of ${plan.credits}`,
      );
    }
  });

  test('prices and credit counts are positive integers', () => {
    for (const plan of Object.values(PLANS)) {
      assert.ok(Number.isInteger(plan.priceTryMinor) && plan.priceTryMinor > 0, `${plan.id} price`);
      assert.ok(Number.isInteger(plan.credits) && plan.credits > 0, `${plan.id} credits`);
      assert.ok(Number.isInteger(plan.invitableSeats) && plan.invitableSeats >= 0, `${plan.id} seats`);
    }
  });

  test('isPlanId agrees with the catalogue', () => {
    for (const id of Object.keys(PLANS)) assert.equal(isPlanId(id), true, id);
    assert.equal(isPlanId('free'), false);
    assert.equal(isPlanId(''), false);
  });
});

// ---------------------------------------------------------------------------
// İkamet applicant mapping
//
// Two vocabularies meet in ikamet-applicant.ts: the intake fields the web side
// collects, and the applicant.json shape the assistant reads. A rename missed
// on either side does not throw — it leaves a box on a government form empty,
// which is noticed weeks later by somebody whose application was rejected.
// ---------------------------------------------------------------------------

describe('İkamet applicant mapping', () => {
  const intake = {
    firstName: 'Test',
    lastName: 'Al-Applicant',
    passportNumber: 'A01234567',
    passportExpiry: '2030-01-01',
    nationality: 'Yemen',
    dateOfBirth: '2003-06-15',
    fatherName: 'Baba Test',
    motherName: 'Ana Test',
    gender: 'Male',
    email: 'test@example.com',
    phone: '+90 555 111 22 33',
    addressInTr: 'Kadıköy, İstanbul',
    entryDate: '2025-09-01',
    permitNumber: '317445',
  };

  test('renames the keys the assistant spells differently', () => {
    const applicant = toAssistantApplicant(intake, false);

    assert.equal(applicant.passportExpiryDate, '2030-01-01');
    assert.equal(applicant.addressInTurkey, 'Kadıköy, İstanbul');
    assert.equal(applicant.residenceCardNo, '317445');

    // The old names must not survive alongside the new ones: a matcher reading
    // the wrong one would look filled while the portal box stayed empty.
    assert.equal(applicant.passportExpiry, undefined);
    assert.equal(applicant.addressInTr, undefined);
    assert.equal(applicant.permitNumber, undefined);
  });

  test('passes everything else through untouched', () => {
    const applicant = toAssistantApplicant(intake, false);
    for (const key of ['firstName', 'lastName', 'passportNumber', 'nationality', 'dateOfBirth', 'fatherName', 'motherName', 'gender', 'email', 'phone', 'entryDate']) {
      assert.equal(applicant[key], intake[key as keyof typeof intake], key);
    }
  });

  test('derives fullName, which givenNames() depends on', () => {
    // documents.mjs works out what belongs in the portal's "Name" box — every
    // given name — by taking the surname off the end of the full name. Without
    // fullName it falls back to the first name alone and under-fills the box.
    const applicant = toAssistantApplicant(intake, false);
    assert.equal(applicant.fullName, 'Test Al-Applicant');
  });

  test('applicationType comes from the service, not from a guess', () => {
    assert.equal(toAssistantApplicant(intake, true).applicationType, 'extension');
    assert.equal(toAssistantApplicant(intake, false).applicationType, 'first');
    // A first application can legitimately carry a permit number (a previous,
    // expired one), so it must never be what decides which form opens.
    assert.equal(toAssistantApplicant({ permitNumber: '1' }, false).applicationType, 'first');
  });

  test('drops blank answers rather than filling boxes with empty strings', () => {
    const applicant = toAssistantApplicant({ firstName: 'A', lastName: '  ', email: '' }, false);
    assert.equal(applicant.firstName, 'A');
    assert.equal(applicant.lastName, undefined);
    assert.equal(applicant.email, undefined);
  });
});

describe('İkamet document slots', () => {
  // itemKey() suffixes each kind with the item's INDEX, so inserting a
  // checklist item silently renumbers every kind after it — orphaning both the
  // uploads already filed and this map. This is the test that notices.
  const kindsFor = (id: string) =>
    (checklistById(id)?.items ?? []).map((item, i) => itemKey(item, i));

  for (const id of ['ikamet_new', 'ikamet_renewal']) {
    test(`every ${id} kind is either mapped or deliberately unmapped`, () => {
      const kinds = kindsFor(id);
      assert.ok(kinds.length > 0, `${id} has no items — did the checklist id change?`);

      // The application form is the one item with no upload slot: the portal
      // produces it at the end of the run rather than asking for it.
      const unmapped = kinds.filter((k) => !documentSlotFor(k));
      for (const kind of unmapped) {
        assert.match(kind, /application-form/, `unexpected unmapped kind: ${kind}`);
      }
    });

    test(`no ${id} kind in the map has gone stale`, () => {
      const kinds = new Set(kindsFor(id));
      const prefix = id === 'ikamet_new' ? ['passport-copy-1', '4-biometric-photos-2'] : ['current-i-kamet-card-number-0'];
      for (const kind of prefix) {
        assert.ok(kinds.has(kind), `${kind} is no longer a ${id} kind — the map needs updating`);
      }
    });
  }

  test('maps only to slots the assistant knows', () => {
    // These are the keys matchDocument() in scripts/ikamet-assistant resolves
    // portal labels to. A value outside this set attaches nothing, silently.
    const slots = new Set([
      'passport', 'photo', 'insurance', 'studentCertificate',
      'addressProof', 'feeReceipt', 'previousPermit',
    ]);
    for (const [kind, slot] of Object.entries(DOCUMENT_KIND_MAP)) {
      assert.ok(slots.has(slot), `${kind} maps to unknown slot "${slot}"`);
    }
  });
});
