# e-İkamet assistant

A human-in-the-loop helper for the Turkish residence-permit portal
(`e-ikamet.goc.gov.tr`). It fills the form and attaches your documents.
**It never submits anything.**

Same model as the [visa booking assistant](../visa-booking-assistant/README.md),
and it imports that assistant's filling engine rather than copying it — the
never-operate guard, the label reading and the field resolution exist once.

## What it does

1. Prints your document checklist **before** opening anything: which files you
   provided, which paths are broken, which are still missing.
2. Opens a visible Chromium window at the İlk Başvuru (or Uzatma) page.
3. You sign in and start the application. It fills each form as it appears —
   text boxes, dropdowns, date pickers and radio groups alike.
4. Attaches each document to the upload slot whose label names it — passport
   to *Pasaport Fotokopisi*, insurance to *Sağlık Sigortası*, and so on.
5. **Stops and waits.** It does not click İleri, Kaydet, Başvuru Yap or
   Randevu Al. That is always your click.
6. When you click through yourself, it notices and fills the next page too.
7. At every pause it reports two separate lists: what it **could not fill**,
   and what is **yours to enter** by design. Running those together is how a
   genuinely missed dropdown used to hide behind the CAPTCHA.
8. Ends when you close the window.

## What it deliberately does not do

- Never clicks any advance, save, submit or appointment button.
- **Never ticks the beyan (declaration) checkbox.** That is you asserting your
  information is true — a legal statement, not a form field.
- Never guesses a document. A slot whose label matches two document types, or
  none, is left empty and reported. Attaching the wrong scan is a rejected
  application weeks later.
- Never overwrites a field that already has a value, so your corrections stand.
- Never runs headless. You watch a real window the whole time.
- Never sends your data anywhere except the portal itself. There is no server
  component.

## Setup

```bash
cp scripts/ikamet-assistant/applicant.example.json scripts/ikamet-assistant/applicant.json
```

Fill it in. **That file is gitignored — it holds passport-level data, never
commit it.** Set `applicationType` to `first` or `extension`, and put absolute
paths to your scans under `documents`.

Field recognition uses Qwen via `DASHSCOPE_API_KEY` in `.env.local`. Without a
key, the fields whose label admits exactly one answer are still filled from the
matcher list — identity and contact details, the two-letter name boxes, the
card number, and all three entry-page dropdowns — and anything more open-ended
is left to you.

## How the portal is actually built

Worth knowing, because it decides what this tool has to do.

e-İkamet is a **Kendo UI** application. It contains no `<select>` elements at
all: every dropdown is a widget mounted on an `<input>` that Kendo then sets to
`display:none`, painting its own wrapper over the top, and the phone box is a
Kendo MaskedTextBox. Three consequences, each of which cost a real run:

- **A hidden input is still a visible field.** A filler that skips
  `display:none` elements skips every dropdown on the form — and, filling and
  reporting sharing one visibility rule, never mentions them as empty either.
- **The form posts a view model, not the inputs.** Values go in through the
  widget's own API and its `change` event. Writing `input.value` leaves a page
  that reads correctly and submits blank.
- **The lists arrive from the server, a page at a time.** Country of
  Nationality loads thirty of two hundred, alphabetically. Anything outside
  the A's has to be searched for; it is simply not on the page to be chosen.

Labels come back in Turkish or English depending on the session, and matching
folds the two together — JavaScript's `/i` flag does **not** fold the dotted
capital `İ` onto ASCII `i`, so `/ilk iki harf/i` does not match `İlk İki
Harfi` without help.

Each page is gone over up to five times, stopping as soon as a pass changes
nothing. One pass is not enough when a dropdown's data is still in flight, and
repeat passes are safe: a field that already holds a value, or that you are
typing in, is never touched.

## Run

```bash
npm run ikamet:fill -- --extension
```

```bash
npm run ikamet:fill -- --new
```

The flag decides which portal form opens — Uzatma (extension) or Ilk Basvuru
(new). It overrides `applicationType` in `applicant.json`, so the same file
serves both this year's extension and a future re-application. With neither
flag it falls back to the file, and the run prints which source it used.

`--uzatma` and `--ilk` work as aliases.

## Test

```bash
node scripts/ikamet-assistant/test.mjs
```

Runs the whole flow against `fixture.html`, a local stand-in for the portal
page — no request reaches goc.gov.tr.

The fixture is built from the live DOM rather than from an idea of it, and
that matters more than it sounds. It reproduces the hidden Kendo dropdowns,
a country list that is only partly loaded, the view model the form posts, an
answer whose code is `0`, and the phone mask. An earlier version used plain
`<select>` elements — a shape the portal never has — so it passed green while
the real run left three mandatory dropdowns on "Please select...".

It asserts that six documents land in the right slots, that an unrecognised
slot stays empty and is reported, that every field fills from your data and
reaches the posted model, that a second pass changes nothing, and that nothing
was clicked, ticked or submitted. The last two are checked by event listeners
inside the page, not by reading the code.

## Document matching

Slots are matched on the label the portal shows, folded through a
Turkish-aware normaliser first: JavaScript's `/i` flag does **not** fold the
dotted capital `İ` onto ASCII `i`, so `/ikamet/i` silently fails to match
`İkamet` — which is exactly how the portal writes it.

| `documents` key | Matches labels like |
|---|---|
| `passport` | Pasaport Fotokopisi, Pasaport Sureti, Passport Copy |
| `photo` | Biyometrik Fotoğraf, Vesikalık Fotoğraf |
| `insurance` | Sağlık Sigortası, Health Insurance |
| `studentCertificate` | Öğrenci Belgesi, Student Certificate |
| `addressProof` | Kira Sözleşmesi, Yurt Belgesi, Adres Beyanı |
| `feeReceipt` | Harç Dekontu, Makbuz, Receipt |
| `previousPermit` | Mevcut İkamet İzni, İkamet Kartı (extensions only) |
