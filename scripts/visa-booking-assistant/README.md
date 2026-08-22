# Mosaic Visa appointment assistant (Türkiye Student Visa, Ashgabat)

A human-in-the-loop helper for booking a Tömer & Student Visa appointment at
Mosaic Visa's Ashgabat office. **It never submits anything on its own.**

## What it does

1. Prints the required-documents checklist (from Mosaic's own published list)
   so you can confirm you're ready before it opens anything.
2. Opens a visible Chromium window and scans the live calendar, month by
   month, for the earliest weekday that still has open capacity, using the
   site's own counter (open days show "Available N", full days show
   "Reserved 0"). Days with 0 remaining are skipped — the site silently
   ignores clicks on them. This is a fresh check every run — slots shift, so
   nothing is cached or assumed from a previous run.
3. Clicks that date with a real browser click (browsing, not submitting).
4. Fills in whatever fields it recognises on the page from `applicant.json`,
   including attaching your acceptance letter to the document upload field.
5. Watches the site's Altcha proof-of-work widget. It is embedded in the
   applicant form and solves itself in-page (nothing is bypassed); the script
   prints when it is still solving and when it is finished, so you don't
   click Next before the token is ready.
6. **Stops and waits.** It does not click Next, Continue, or Apply — on any
   page, including the very last one. That's always your click.
7. Once you click through to the next step yourself, it notices the page
   changed and fills that one too, then waits again. This repeats for as
   many steps as the real flow turns out to have, all the way to the final
   Apply page.
8. Ends when you close the browser window.

## What it deliberately does not do

- Never clicks any advance/submit/pay button, ever.
- **Never ticks the "I confirm that all the information provided in my
  appointment form is correct" checkbox.** That is you asserting your
  information is true — a legal statement, not a form field. The script
  enforces this at runtime, not just by convention: every write goes through
  a guard that refuses to operate any checkbox or button (`NEVER_OPERATE` in
  `find-slot.mjs`).
- Never runs headless or in the background — you watch a real browser window
  the whole time.
- Never attempts to evade bot detection. The site's Altcha widget runs
  exactly as designed — it fetches the challenge from
  `/altcha/challenge` and computes the proof-of-work in the page itself. The
  script only reports its state (solving / solved) and never touches or
  forges the widget or its hidden `altcha` input.
- Never sends applicant data anywhere except the Mosaic site itself. There's
  no server component — this runs entirely on your machine.

## Setup

```bash
cp scripts/visa-booking-assistant/applicant.example.json scripts/visa-booking-assistant/applicant.json
```

Fill in `applicant.json` with the real applicant details — the template lists
every field the form asks for, grouped as identity / passport / contact /
travel. This file holds passport-level PII and is git-ignored — **never commit
it.**

Set `mainSupportingDocumentPath` to the absolute path of the acceptance or
invitation letter from the Turkish institution; the script attaches it to the
form's upload field for you. Leave it empty and the script just reminds you to
attach it yourself.

## Run

```bash
npm run visa:find-slot
```

## Running it for clients from the web chat

`visa:find-slot` reads one local `applicant.json`. If clients give their
details through the site's chat instead, use the watcher:

```bash
npm run visa:watch
```

The chat collects the applicant's answers and their acceptance letter, and the
watcher waits for one to be finished. The moment it is, the watcher opens a
browser by itself, finds the earliest date, and fills the whole form with that
client's details — no download, no copy-paste, no manual start. You review each
page and click through, exactly as with `visa:find-slot`.

This can only run on a machine you control, not in the client's browser: your
server cannot drive a visitor's browser, and same-origin rules stop any page on
your site from typing into `mosaicvisa.com`.

It needs two things in `.env.local`:

| Variable | Purpose |
|---|---|
| `VISA_WATCH_TOKEN` | Auth token for an **admin** account — the applications endpoint is admin-only |
| `VISA_WATCH_API_BASE` | Your site's URL (defaults to `NEXT_PUBLIC_APP_URL`, else `http://localhost:3000`) |

The polling is against **your own API**, never Mosaic's. Nothing contacts the
visa site until a client has actually finished an application and you are sitting
in front of the browser.

When you close the window it asks whether the booking went through. Answering
yes deletes the client's details and their letter; answering no returns the
application to the queue untouched. Applications are purged automatically after
30 days regardless, so passport data does not pile up.

## Notes

- Open-capacity detection reads the site's own `data-remaining` counter on
  each calendar row rather than guessing from visible text. Days showing
  "Reserved 0" are fully booked and their rows ignore clicks — the script
  never selects them.
- After the date is selected, the applicant form contains an `<altcha-widget>`
  that solves itself automatically (usually within a few seconds). The script
  logs `🧩 Altcha solved ✓` when it is safe to click Next Step; if you click
  too early and the site rejects the step, the widget re-solves on its own
  and the script reports the state again.
- **Field recognition reads labels, it does not pattern-match them.** Only
  three genuinely unambiguous labels (Mobile, E-mail, Number of Applicant)
  use a static matcher. Everything else is resolved by asking Qwen what
  belongs in that field, given the field's real label and type, the other
  labels on the same page, and your `applicant.json`.

  Sibling labels matter more than they sound: a field called "Name" next to a
  separate "Surname" field wants only the given name, while "Name" on its own
  would want the whole name. Earlier keyword matching got this wrong, and got
  "Passport Issued Place" wrong too by matching it on "Passport" and writing
  the passport *number* into a field that wants a city.

  If the model isn't confident, it returns nothing and the field stays empty
  for you — it never invents passport data.
- **Dates** are converted to the ISO `YYYY-MM-DD` that native `<input
  type=date>` requires, so you can write `15/06/2022` or `2022-06-15` in
  `applicant.json` and either works.
- **At every pause it lists what's still empty**, so you don't have to scroll
  the form hunting for gaps:

  ```
    ⚠️  Still empty (fill these yourself): Place of Birth, Occupation
    ⏸  Page ready for review — click Next / Apply yourself when ready.
  ```
- It never overwrites a field that already has a value, so if you correct
  something it filled, later passes won't stomp on your edit.
