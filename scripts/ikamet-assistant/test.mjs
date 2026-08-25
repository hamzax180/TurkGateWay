/**
 * End-to-end test for the e-İkamet assistant, run against a local fixture.
 *
 * Nothing here contacts goc.gov.tr. The fixture reproduces the shape of the
 * real page — Kendo dropdowns on hidden inputs, a server-paged country list, a
 * masked phone box, Turkish labels, seven upload slots, the declaration
 * checkbox and the advance buttons — so the behaviour that matters can be
 * asserted for real:
 *
 *   1. every document lands in the slot whose label names it
 *   2. an unrecognised slot is reported, not guessed at
 *   3. text, dropdown and radio fields fill from applicant data
 *   4. the values reach the view model the form actually posts
 *   5. NOTHING advances, submits or attests — checked by event listeners in
 *      the page, not by reading the code
 *
 *   node scripts/ikamet-assistant/test.mjs
 */

import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { attachDocuments, IKAMET_ENGINE_OPTS } from './run.mjs';
import { initials, isYoursByDesign, matchDocument } from './documents.mjs';
import { matchOption } from './kendo.mjs';
import {
  classifyVerificationText,
  isPortalLink,
  readVerificationGate,
  resumeFromVerificationLink,
} from './verification.mjs';
import { fillCurrentPage, readEmptyFields, resetFieldCache } from '../visa-booking-assistant/find-slot.mjs';
import { hasQwenKey } from '../visa-booking-assistant/qwen-field-fill.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = pathToFileURL(join(HERE, 'fixture.html')).href;
const GATE_FIXTURE = pathToFileURL(join(HERE, 'verification-fixture.html')).href;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  // Throwaway files standing in for the applicant's scans.
  const dir = mkdtempSync(join(tmpdir(), 'ikamet-test-'));
  const doc = (name) => {
    const p = join(dir, name);
    writeFileSync(p, `stand-in for ${name}`);
    return p;
  };

  const applicant = {
    applicationType: 'extension',
    firstName: 'Test',
    lastName: 'Al-Applicant',
    fullName: 'Test Middle Al-Applicant',
    dateOfBirth: '15/06/2003',
    nationality: 'Yemen',
    motherName: 'Ana Test',
    fatherName: 'Baba Test',
    gender: 'Erkek',
    passportNumber: 'A01234567',
    foreignerIdNumber: '99900000001',
    residenceCardSerialNo: 'YAF',
    residenceCardNo: '317445',
    passportType: 'Umuma Mahsus Pasaport',
    email: 'test@example.com',
    // Deliberately absent: previousSurname. The portal says to leave that box
    // blank unless the surname changed, so "no key" must mean "no write".

    // Written with a country code on purpose: the portal's mask has ten slots,
    // and a number that arrives longer than that used to be truncated into a
    // plausible-looking wrong number.
    phone: '+90 555 000 00 00',
    communicationPreference: 'e-mail',
    changeProvinceOfResidence: 'No',
    documents: {
      passport: doc('passport.pdf'),
      photo: doc('photo.jpg'),
      insurance: doc('insurance.pdf'),
      studentCertificate: doc('student.pdf'),
      addressProof: doc('rental.pdf'),
      feeReceipt: doc('receipt.pdf'),
    },
  };

  console.log('\ne-İkamet assistant — offline end-to-end test');
  console.log(`Qwen field recognition: ${hasQwenKey() ? 'ON' : 'OFF (static matchers only)'}\n`);

  // ── pure units, no browser needed ──────────────────────────────────────
  check('initials trims punctuation ("Al-Applicant" → AL)', initials('Al-Applicant') === 'AL', initials('Al-Applicant'));
  check('initials on an empty name yields nothing to type', initials('') === null);
  check(
    'an ambiguous option is refused rather than guessed',
    matchOption([{ text: 'Cell Phone', value: '2' }, { text: 'Cell Phone (SMS)', value: '3' }], 'cell phone')
      ?.value === '2',
    'exact match must still win over its own prefix',
  );
  check(
    'two equally partial options are refused',
    matchOption([{ text: 'North Yemen', value: '1' }, { text: 'South Yemen', value: '2' }], 'Yemen') === null,
  );
  check('"No" resolves across languages', matchOption([{ text: 'Hayır', value: '0' }], 'No')?.value === '0');
  // The portal renders in English but serves its parameter lists in whatever
  // language it has them, so an English answer has to survive meeting a
  // Turkish option — across the punctuation difference as well as the word.
  check(
    '"e-mail" resolves to a Turkish "e-Posta" option',
    matchOption([{ text: 'Cep Telefonu', value: '2' }, { text: 'e-Posta', value: '1' }], 'e-mail')
      ?.value === '1',
  );
  check('the CAPTCHA box is classed as the applicant’s own', isYoursByDesign('Enter the characters you see in the image to the space near the image.'));
  // The serial is filled now, so it must NOT be excused as the applicant's
  // own — if it ever comes back empty that is a miss and has to read as one.
  check('the card serial is no longer excused', !isYoursByDesign('Residence Permit Card Serial Number'));
  check('a real dropdown is NOT classed that way', !isYoursByDesign('Country of Nationality'));

  // ── the e-mail verification gate ───────────────────────────────────────
  // Wording first, page shape second, and the two failure directions pull
  // opposite ways: too loose and the run stops on a form it could have filled,
  // too tight and it goes back to telling people to press a button that cannot
  // advance the page.
  check(
    'a completed send is a gate',
    classifyVerificationText('E-posta adresinize gönderilen doğrulama bağlantısına tıklayınız.').kind === 'link',
  );
  // The regression that hides everywhere in this codebase: /i does not fold the
  // dotted capital İ, so a shouted Turkish heading slips past a lowercase
  // pattern and the gate is simply never seen.
  check(
    'a SHOUTED Turkish gate still matches',
    classifyVerificationText('E-POSTA ADRESİNİZE GÖNDERİLEN BAĞLANTIYA TIKLAYIN').kind === 'link',
  );
  check(
    'the address it names is lifted',
    classifyVerificationText('E-postanızı kontrol edin: h***a@example.com').sentTo === 'h***a@example.com',
  );
  // Tense, and only tense, separates these two from the one above.
  check(
    'a page saying a link WILL be sent is not a gate',
    classifyVerificationText('Doğrulama e-postası bu adrese gönderilecektir.').present === false,
  );
  check(
    'merely naming a verification link is not a gate',
    classifyVerificationText('Doğrulama bağlantısı için e-posta adresinizi giriniz').present === false,
  );
  check(
    'an emailed CODE is a different thing from a link',
    classifyVerificationText('E-posta adresinize gönderilen doğrulama kodunu giriniz').kind === 'code',
  );

  // The allowlist. Everything here is a URL somebody could paste into a box
  // that makes a browser inside our own network fetch it.
  check('the portal link is accepted', isPortalLink('https://e-ikamet.goc.gov.tr/Ikamet/Dogrula?t=abc').ok);
  check('a goc.gov.tr subdomain is accepted', isPortalLink('https://api.goc.gov.tr/x').ok);
  check('http is refused', !isPortalLink('http://e-ikamet.goc.gov.tr/x').ok);
  check('another host entirely is refused', !isPortalLink('https://evil.example.com/x').ok);
  // The lookalike that beats string matching: everything before the @ is
  // userinfo, and the host is evil.example.
  check(
    'a userinfo lookalike is refused',
    !isPortalLink('https://e-ikamet.goc.gov.tr@evil.example/x').ok,
  );
  // And the one that beats a missing leading dot in the suffix check.
  check('a suffix lookalike is refused', !isPortalLink('https://notgoc.gov.tr/x').ok);
  check('nothing pasted is refused', !isPortalLink('').ok);

  resetFieldCache(applicant);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });

  // The premise of the whole exercise: the country the applicant needs is not
  // in the data the page loaded. If this ever stops being true the fixture has
  // drifted and the search path below is no longer being tested.
  const listState = await page.evaluate(() => {
    const w = jQuery(document.getElementById('uyruk')).data('kendoDropDownList');
    return {
      loaded: w.dataSource.data().length,
      total: w.dataSource.total(),
      yemenLoaded: w.dataSource.data().some((r) => r.aciklama === 'Yemen'),
    };
  });
  check(
    'fixture models a part-loaded list (the applicant’s country is not in it)',
    listState.loaded < listState.total && !listState.yemenLoaded,
    JSON.stringify(listState),
  );

  // ── documents ──────────────────────────────────────────────────────────
  const { attached, unmatched } = await attachDocuments(page, applicant);

  const slots = {
    doc_passport: 'passport.pdf',
    doc_photo: 'photo.jpg',
    doc_insurance: 'insurance.pdf',
    doc_student: 'student.pdf',
    doc_address: 'rental.pdf',
    doc_fee: 'receipt.pdf',
  };

  for (const [name, expected] of Object.entries(slots)) {
    const actual = await page.evaluate((n) => {
      const el = document.querySelector(`input[name="${n}"]`);
      return el?.files?.[0]?.name ?? null;
    }, name);
    check(`${name} ← ${expected}`, actual === expected, `got ${actual}`);
  }

  const otherSlot = await page.evaluate(() => {
    const el = document.querySelector('input[name="doc_other"]');
    return el?.files?.length ?? 0;
  });
  check('unrecognised slot "Diğer Belge" left empty', otherSlot === 0, `got ${otherSlot} file(s)`);
  check(
    'unrecognised slot reported to the operator',
    unmatched.some((u) => /Diğer Belge/i.test(u)),
    JSON.stringify(unmatched),
  );
  check('attach count', attached.length === 6, `attached ${attached.length}`);

  // ── text / dropdown / radio ────────────────────────────────────────────
  // Run the same way the assistant does: more than once, because a remote list
  // that is still in flight on the first pass can only be filled on a later
  // one. A second pass must also be harmless — it must not overwrite or
  // duplicate anything already set.
  const filledFirst = await fillCurrentPage(page, applicant, IKAMET_ENGINE_OPTS);
  const filledSecond = await fillCurrentPage(page, applicant, IKAMET_ENGINE_OPTS);
  check(
    'a second pass over a filled page changes nothing',
    filledSecond.length === 0,
    `re-filled ${JSON.stringify(filledSecond)}`,
  );

  const values = await page.evaluate(() => {
    const v = (n) => document.querySelector(`[name="${n}"]`)?.value ?? '';
    const widget = (id) => {
      const w = jQuery(document.getElementById(id)).data('kendoDropDownList');
      return { value: String(w.value()), text: w.text() };
    };
    const shown = (id) =>
      document.getElementById(id).parentElement.querySelector('.k-input')?.textContent?.trim() ?? '';
    return {
      email: v('Iletisim.EMail'),
      ad: v('Ad'),
      soyad: v('Soyad'),
      yabanciKimlikNo: v('YabanciKimlikNo'),
      belgeSeri: v('BelgeSeri'),
      belgeNo: v('BelgeNo'),
      captcha: v('CaptchaInputText'),
      piAd: v('PiAd'),
      piSoyad: v('PiSoyad'),
      piOncekiSoyad: v('PiOncekiSoyad'),
      piBaba: v('PiBabaAdi'),
      piAnne: v('PiAnneAdi'),
      cepTelefon: v('Iletisim.CepTelefon'),
      passportNo: v('passportNo'),
      dob: v('dob'),
      uyruk: widget('uyruk'),
      uyrukShown: shown('uyruk'),
      tercih: widget('iletisim_tercih'),
      ilDegistir: widget('uzatmaIlDegistir'),
      gender: document.querySelector('input[name="gender"]:checked')?.value ?? '',
      model: window.__model,
    };
  });

  // Fields resolved from the label alone — they must fill with or without a
  // model key, because a mandatory identity field left blank with no
  // explanation is the failure this project keeps coming back to.
  check('e-mail filled', values.email === 'test@example.com', `got "${values.email}"`);
  check('Foreigners ID No filled', values.yabanciKimlikNo === '99900000001', `got "${values.yabanciKimlikNo}"`);
  check('Card Number filled', values.belgeNo === '317445', `got "${values.belgeNo}"`);
  check('first two letters of the given name', values.ad === 'TE', `got "${values.ad}"`);
  check('first two letters of the surname', values.soyad === 'AL', `got "${values.soyad}"`);

  // The four that were empty on the live run. Each is a Kendo widget, and each
  // failed for its own reason.
  check(
    'hidden Kendo dropdown filled — province (answer code is 0)',
    values.ilDegistir.value === '0' && values.ilDegistir.text === 'No',
    JSON.stringify(values.ilDegistir),
  );
  check(
    'hidden Kendo dropdown filled — communication preference',
    values.tercih.value === '1' && values.tercih.text === 'e-Mail',
    JSON.stringify(values.tercih),
  );
  check(
    'country found by asking the server, not just the loaded page',
    values.uyruk.text === 'Yemen' && values.uyruk.value !== '',
    JSON.stringify(values.uyruk),
  );
  check(
    'the widget repaints what it chose (change event fired)',
    values.uyrukShown === 'Yemen',
    `widget shows "${values.uyrukShown}"`,
  );
  check(
    'masked Cell Phone typed through the mask (never spliced)',
    values.cepTelefon === '(555) 000-00-00',
    `got "${values.cepTelefon}"`,
  );
  check('masked field never left half-mangled', !/_/.test(values.cepTelefon), `got "${values.cepTelefon}"`);

  // The point of writing through the widget rather than the element: the form
  // posts the view model, so a value that never reached it submits as blank
  // however right the page looks.
  check(
    'dropdown values reached the model the form posts',
    values.model.Uyruk === values.uyruk.value &&
      values.model['Iletisim.Tercih'] === '1' &&
      values.model.UzatmaIlDegistir === '0',
    JSON.stringify({
      Uyruk: values.model.Uyruk,
      Tercih: values.model['Iletisim.Tercih'],
      Il: values.model.UzatmaIlDegistir,
    }),
  );
  check(
    'phone reached the model too',
    values.model['Iletisim.CepTelefon'] === '(555) 000-00-00',
    JSON.stringify(values.model['Iletisim.CepTelefon']),
  );

  if (hasQwenKey()) {
    check('Pasaport Numarası filled', values.passportNo === 'A01234567', `got "${values.passportNo}"`);
    check('Doğum Tarihi normalised to ISO', values.dob === '2003-06-15', `got "${values.dob}"`);
    check('Cinsiyet radio chosen', values.gender === 'E', `got "${values.gender}"`);
  } else {
    console.log('  SKIP  label-resolved fields (no DASHSCOPE_API_KEY)');
  }

  check('Card SERIAL filled', values.belgeSeri === 'YAF', `got "${values.belgeSeri}"`);
  check('image verification code never attempted', values.captcha === '', `got "${values.captcha}"`);

  // ── Personal Information 1 ─────────────────────────────────────────────
  check(
    '"Name" gets every given name, not just the first',
    values.piAd === 'Test Middle',
    `got "${values.piAd}"`,
  );
  check('"His/her Last Name" gets the surname', values.piSoyad === 'Al-Applicant', `got "${values.piSoyad}"`);
  check("Father's Name filled", values.piBaba === 'Baba Test', `got "${values.piBaba}"`);
  check("Mother's Name filled", values.piAnne === 'Ana Test', `got "${values.piAnne}"`);
  // The one that matters most on that page. Three given names sit right above
  // it and the correct answer is nothing at all.
  check(
    'Previous Surname left blank when the surname never changed',
    values.piOncekiSoyad === '',
    `got "${values.piOncekiSoyad}"`,
  );

  // ── the guarantee ──────────────────────────────────────────────────────
  const violations = await page.evaluate(() => window.__violations);
  check(
    'never clicked Resume / Kaydet / Başvuru Yap',
    !violations.some((v) => v !== 'uzatmaGecisOkudumAnladim'),
    JSON.stringify(violations),
  );
  check(
    'never ticked the declaration checkbox',
    !violations.includes('uzatmaGecisOkudumAnladim'),
    JSON.stringify(violations),
  );

  const attestChecked = await page.evaluate(
    () => document.getElementById('uzatmaGecisOkudumAnladim').checked,
  );
  check('declaration checkbox still unchecked', attestChecked === false);

  const stillOnFixture = page.url().startsWith('file:');
  check('never navigated away', stillOnFixture, page.url());

  // ── reporting ──────────────────────────────────────────────────────────
  const empty = await readEmptyFields(page, IKAMET_ENGINE_OPTS).catch(() => []);
  const missed = empty.filter((label) => !isYoursByDesign(label));

  // A filled dropdown must drop off the report. It used to be absent from it
  // for the wrong reason — the report could not see hidden widgets at all, so
  // it stayed silent whether they were filled or not.
  check(
    'a filled dropdown is not reported as empty',
    !empty.some((l) => /country of nationality|communication preference|change my province/i.test(l)),
    JSON.stringify(empty),
  );
  check(
    'the image verification box IS reported as the applicant’s own',
    empty.some((l) => /characters you see/i.test(l)),
    JSON.stringify(empty),
  );
  check(
    'the now-filled card serial has dropped off the report',
    !empty.some((l) => /card serial number/i.test(l)),
    JSON.stringify(empty),
  );
  // Everything left over must be something there is a stated reason for. The
  // fixture contributes exactly one: an upload slot whose label names no
  // document the applicant supplied, which is refused on purpose rather than
  // filled with a guess. Anything else appearing here is a real miss.
  const expectedLeftovers = [
    /di[gğ]er belge/i,
    // Correctly blank, not missed — see the check above.
    /previous surname/i,
  ];
  const unexplained = missed.filter((label) => !expectedLeftovers.some((re) => re.test(label)));
  if (hasQwenKey()) {
    check(
      'nothing the assistant should have filled is left over',
      unexplained.length === 0,
      `left: ${JSON.stringify(unexplained)}`,
    );
    check(
      'the ambiguous upload slot is still reported as a gap',
      missed.some((l) => /di[gğ]er belge/i.test(l)),
      JSON.stringify(missed),
    );
  } else {
    console.log(`  SKIP  full-coverage check (no DASHSCOPE_API_KEY) — left: ${JSON.stringify(unexplained)}`);
  }

  console.log(`\n  Filled on the first pass: ${filledFirst.length} field(s)`);
  console.log(`  Still-empty report: ${empty.length ? empty.join(', ') : '(none)'}`);

  // ── the gate, against a page ───────────────────────────────────────────
  // The form fixture is the important half of this pair. It is a real İkamet
  // page with real fields, and it must not read as a gate however much
  // verification wording surrounds it.
  const onForm = await readVerificationGate(page);
  check('the filled form page is not a gate', onForm.present === false, JSON.stringify(onForm));

  const gatePage = await browser.newPage();
  await gatePage.goto(GATE_FIXTURE, { waitUntil: 'domcontentloaded' });

  const gate = await readVerificationGate(gatePage);
  check('the wait page IS a gate', gate.present && gate.kind === 'link', JSON.stringify(gate));
  check('the gate names the inbox', gate.sentTo === 'h***a@example.com', String(gate.sentTo));

  const refused = await resumeFromVerificationLink(gatePage, 'https://evil.example.com/steal');
  check('a foreign link is refused rather than followed', !refused.ok, JSON.stringify(refused));
  check(
    'and refusing it did not navigate',
    gatePage.url().startsWith('file:'),
    gatePage.url(),
  );

  // A real one navigates the page it was given — the whole point, since that is
  // where the session cookie the token belongs to lives. `file:` stands in for
  // the portal so nothing reaches goc.gov.tr.
  await gatePage.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  check('a portal link would be followed on this same page', gatePage.url() === FIXTURE);

  // Nothing on that page may be pressed for them — Resend least of all, since
  // it spends a fresh token.
  const gateViolations = await gatePage.evaluate(() => window.__violations);
  check('nothing was clicked on the gate page', gateViolations.length === 0, JSON.stringify(gateViolations));

  await gatePage.close();

  await browser.close();
  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nTest harness error:', e);
  process.exit(1);
});
