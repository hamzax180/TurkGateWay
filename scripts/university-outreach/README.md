# University outreach mailer

Sends one personalised email per Turkish foundation university from
`international@turkgateway.com`, reading the recipient list straight out of
[`universities/turkey_private_university_emails.xlsx`](../../universities/turkey_private_university_emails.xlsx).

**Nothing is sent unless you pass both `--send` and `--confirm`.** Every other
mode is a dry run.

No dependencies beyond `openpyxl` (already installed) — sending uses Python's
built-in `smtplib`.

---

## 1. Edit the template first

`template.txt` (plain text) and `template.html` (HTML version) ship with
placeholders in `[CAPITALS]`:

- `[YOUR NAME]`
- `[YOUR TITLE]`

**The script refuses to send while any `[CAPITAL]` placeholder is still in the
rendered message.** Fill them in in *both* files.

Per-recipient values are filled automatically:

| Placeholder | Becomes |
|---|---|
| `{{university}}` | İstanbul Gelişim Üniversitesi |
| `{{city}}` | İstanbul |
| `{{greeting}}` | `International Admissions team`, or `International Office` for generic inboxes |
| `{{department}}` | International Admissions |
| `{{website}}` | https://gelisim.edu.tr |
| `{{email}}` | the recipient address |
| `{{intake}}` | `2026/2027`, or `$OUTREACH_INTAKE` |

The subject line is the first line of `template.txt` and must start with
`Subject:`.

## 2. Set the mailbox credentials

Put these in `.env.local` (already gitignored) or export them in your shell.
**The script never stores or prints the password** — set it yourself:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=international@turkgateway.com
SMTP_PASSWORD=
OUTREACH_FROM=international@turkgateway.com
OUTREACH_FROM_NAME=TurkGateway
OUTREACH_REPLY_TO=international@turkgateway.com
OUTREACH_INTAKE=2026/2027
```

Common hosts — check which one actually serves `turkgateway.com`:

| Provider | `SMTP_HOST` | Port |
|---|---|---|
| Google Workspace | `smtp.gmail.com` | 587 |
| Microsoft 365 | `smtp.office365.com` | 587 |
| Yandex 360 | `smtp.yandex.com` | 465 |
| cPanel / shared hosting | `mail.turkgateway.com` | 465 or 587 |

Port `465` switches to implicit SSL automatically; anything else uses STARTTLS.

If the mailbox has 2FA (Google Workspace and Microsoft 365 both do), you need an
**app password**, not the normal login password.

## 3. Dry run, then test, then send

```bash
# 1. what would go out — sends nothing
python scripts/university-outreach/send_outreach.py

# 2. read three complete emails
python scripts/university-outreach/send_outreach.py --preview 3

# 3. one real email to yourself, to check formatting and spam placement
python scripts/university-outreach/send_outreach.py --test-to you@turkgateway.com --limit 1 --send --confirm

# 4. the real run
python scripts/university-outreach/send_outreach.py --send --confirm
```

## Flags

| Flag | Meaning |
|---|---|
| `--send` | actually transmit (needs `--confirm` too) |
| `--confirm` | second key — no single typo sends 43 emails |
| `--status confirmed\|inferred\|all` | default `confirmed`. See below. |
| `--limit N` | stop after N recipients |
| `--delay S` | seconds between sends, plus up to 35% jitter (default `20`) |
| `--test-to ADDR` | redirect every message to ADDR; not written to the sent log |
| `--preview N` | print N rendered emails and exit |
| `--only SUBSTR` | filter by university name or address |
| `--resend` | ignore the sent log and include already-contacted addresses |
| `--workbook` / `--sheet` | use a different source file |

## Why `--status confirmed` is the default

The workbook marks each address either `Confirmed` (found in plain text on the
university's own site — 43 rows) or `Inferred (pattern)` (a guess like
`international@<domain>`, because the site hid the address — 31 rows).

Sending to guessed addresses produces bounces, and a burst of bounces is exactly
what makes a young sending domain start landing in spam. Work the confirmed list
first; verify the inferred ones by hand before running with `--status inferred`.

## Safety behaviour

- **Dry run by default.** `--send` alone is not enough.
- **Rendered up front.** All messages are built before the first one is sent, so
  a template mistake fails at message 0, not message 20.
- **`sent_log.json`** records every delivered address and is written after each
  send. Re-running skips them, so an interrupted run resumes cleanly and nobody
  is emailed twice. It is gitignored (it is a contact record).
- **Aborts after 5 consecutive SMTP failures** — that usually means throttling
  or a blocked account, and continuing makes it worse.
- **Ctrl-C safe.** Progress is already on disk.
- **`List-Unsubscribe` header** plus an opt-out line in the body.

Reset the history with `rm scripts/university-outreach/sent_log.json`.

## Before the real run

- Confirm `turkgateway.com` has **SPF, DKIM and DMARC** published. Without them
  74 messages from a new address will land in spam or be rejected outright.
- Check your provider's daily cap (Google Workspace: 2,000/day; Microsoft 365:
  10,000/day; shared cPanel hosting is often 200–500/hour).
- At the default 20s delay, 43 emails take roughly 15 minutes.
