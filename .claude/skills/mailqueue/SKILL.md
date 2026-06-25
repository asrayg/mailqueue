---
name: mailqueue
description: >-
  Drive the MailQueue CLI to send controlled, scheduled, multi-provider cold-outreach /
  follow-up emails through Gmail, Outlook, or Zoho via Playwright browser automation (no SMTP,
  no API keys, uses the user's own logged-in session). Use when the user wants to
  create/preview/start/pause/resume/cancel an email campaign, import a CSV of recipients,
  send a one-off or scheduled ("send later") email, run the send worker, send a test email,
  check campaign/recipient/log status, or when a provider's web UI changed and the automation
  selectors need fixing + a PR. Not for transactional email, SMTP, or provider-API sending.
---

# MailQueue CLI — operator's guide

MailQueue sends the same (or `{{variable}}`-personalized) email to many recipients
**gradually** — within a sending window, under hourly/daily caps, with randomized delays —
by driving each provider's real web UI with Playwright, using the user's own logged-in
browser session. No SMTP, no API keys, no stored passwords.

This guide is the hub. Deep detail lives in bundled references you should read when relevant:

- **`reference/cli.md`** — every command, every flag, exact `--json` output shapes, exit codes.
- **`reference/providers.md`** — the working selector map per provider + known quirks (read this
  before touching `providers/*.ts`).
- **`reference/drift-recovery.md`** — step-by-step playbook for fixing + PR-ing a broken provider.

## Safety stance (non-negotiable)

MailQueue is for **consensual, legitimate outreach and follow-ups — not spam.** You must keep
its safeguards intact and must **refuse** to:

- bypass CAPTCHAs, 2FA, "verify it's you" / security challenges, or any anti-abuse system;
- rotate/multiplex accounts to evade sending limits, or hide/spoof identity;
- remove or weaken the auto-pause logic, rate caps, randomized delays, or duplicate prevention;
- scrape inboxes for addresses, or send to purchased / non-consensual lists;
- raise caps to clearly abusive volumes or shrink delays to spam-like speed.

The app already auto-pauses on CAPTCHA, security warnings, logout, send-button-unavailable, and
after 3 consecutive failures. Leave that behavior in place. If a user asks for any of the above,
decline plainly and explain MailQueue is for controlled, consensual outreach.

## Golden rules for driving it

1. **Always pass `--json`** and parse it. Every command prints a JSON object with `ok: true|false`
   (errors: `{"ok":false,"error":"..."}` + non-zero exit). Never scrape human text.
2. **Never start a real campaign without `campaign preview` first.** Show the user recipient count,
   duplicates, invalid emails, missing template vars, attachment problems, and `startBlockers`.
   `campaign start` itself refuses on 0 recipients or missing/oversized attachments.
3. **Send a test to the user first** (`campaign test`) and get explicit confirmation before `start`.
4. **The worker must run** for app-controlled (Mode 1) sends to actually go out
   (`npm run mq -- worker`). For provider-native scheduling that fires with the app closed, use
   `--in`/`--at` (Mode 2).
5. **Trust delivery, not the UI.** A provider "Message sent" toast has produced false positives.
   When it matters, confirm real delivery (e.g. a Gmail tool / the recipient's inbox / the
   provider's Scheduled/Sent folder). For scheduled sends, **wait until past the scheduled time**
   before checking — checking early looks like a failure.
6. **Run from the repo root** (or use the globally-linked `mailqueue`, which resolves project paths
   absolutely). If commands error, see Environment check below.

## Environment check (run once before first use)

```bash
node -v                              # need a modern Node (process.loadEnvFile etc.)
ls prisma/dev.db 2>/dev/null || npm run prisma:migrate   # create the DB if missing
ls ~/Library/Caches/ms-playwright 2>/dev/null \
  | grep -qi chromium || npx playwright install chromium # browser for automation
test -f .env || cp .env.example .env  # set TEST_RECIPIENT_EMAIL to an address the user owns
```

Then verify a provider is logged in: `npm run mq -- --json provider test <provider>` should return
`status:"sent"`. First time, it opens a browser and waits up to 5 min for manual login.

## How to invoke

```bash
npm run mq -- <args>          # canonical, always works from the repo root
mailqueue <args>              # if globally linked (postinstall does this; resolves project paths)
node bin/mailqueue.js <args>  # equivalent direct launcher
```

Add `--json` right after `mailqueue`/`mq --`, e.g. `npm run mq -- --json campaign list`.

## Core concepts

- **Providers**: `gmail`, `outlook`, `zoho`. Adapter pattern in `providers/`; each implements
  login/compose/attach/send/schedule/verify with a shared safety gate.
- **Campaign lifecycle**: `draft → confirmed/running → paused ↔ running → completed | cancelled`.
  `campaign start` moves draft→running; the worker marks `completed` when no pending recipients
  remain; serious errors move it to `paused` with `lastError` set.
- **Recipient states**: `pending → scheduled → sent | failed | skipped`. `skipped` = duplicate or
  contacted within the re-contact window. `retry` resets `failed → pending`.
- **Mode 1 (app-controlled)**: worker waits for the window/caps/delay, then sends now. The worker
  process must stay running. This is the default for campaigns.
- **Mode 2 (provider-native schedule send)**: `send`/`provider test` with `--in <min>`/`--at <iso>`
  uses the provider's "Schedule send"/"Send later" dialog; the mail goes out at that time **with
  the app closed**. (Per-recipient Mode 2 inside campaigns is a roadmap item; today it's exposed
  via `send`/`provider test`.)
- **Templates**: `{{first_name}}`, `{{last_name}}`, `{{company}}`, `{{email}}`, plus any CSV column.
  Missing vars render blank and are surfaced by `campaign preview` (`missingVars`).
- **CSV**: must have an `email` column; optional `first_name`, `last_name`, `company`, and any
  extra columns. Emails are trimmed, lowercased, de-duplicated; invalid rows dropped.
- **CC**: supported on all three providers. A campaign-level fixed CC (`campaign create --cc`, stored
  on the campaign) is added to every send; one-off `send`/`provider test` take `--cc` too. Comma-
  separated for multiple. (BCC is not implemented yet.)
- **Data model** (SQLite via Prisma): `Campaign`, `Recipient`, `SendLog`, `GlobalContactHistory`
  (cross-campaign de-dup). `GlobalContactHistory` is written on real sends (not test sends), so a
  recipient contacted within `recontactAfterDays` is auto-skipped in future campaigns.

## Command reference (summary — full detail in `reference/cli.md`)

| Group | Commands |
| --- | --- |
| `campaign` | `create` · `list` · `show <id>` · `preview <id>` · `import <id> --csv` · `recipients <id>` · `test <id>` · `start <id>` · `pause/resume/cancel <id>` · `retry <id>` · `logs <id>` |
| `provider` | `login <p>` · `test <p>` |
| top-level | `send` · `worker [--once]` |

Exit codes: `0` ok · `2` send failed · `4` campaign not found · `5` start refused (blockers). Run
`npm run mq -- <cmd> --help` for flags. **Read `reference/cli.md` for every flag + JSON shape.**

## Workflow: run a campaign end to end

```bash
# 0. (first time per provider) interactive login — opens a browser
npm run mq -- provider login gmail

# 1. create a draft from a CSV (body in a file keeps multiline/quotes clean)
npm run mq -- --json campaign create --name "Q3 shops" --provider gmail \
  --subject "Quick question about {{company}}" --body-file body.txt \
  --csv contacts.csv --attach deck.pdf \
  --window 09:00-16:30 --tz America/Chicago --days weekdays \
  --max-per-hour 10 --max-per-day 25 --delay 300-900 --recontact 30
#   → capture .id from the JSON

# 2. preview — STOP, show the user. Check canStart / startBlockers / missingVars / attachments.
npm run mq -- --json campaign preview <id>

# 3. send the user a test, get an explicit OK
npm run mq -- campaign test <id> --to user@theirdomain.com

# 4. start (refuses on 0 recipients or bad attachments), then run the worker
npm run mq -- --json campaign start <id>
npm run mq -- worker            # keep running; sends gradually within window+caps

# 5. monitor
npm run mq -- --json campaign show <id>                       # stats + lastError
npm run mq -- --json campaign recipients <id> --status failed # who failed and why
npm run mq -- --json campaign logs <id>                       # full send log
```

To advance sends deterministically in a test (one pass, ignores randomized delay):
`npm run mq -- --json worker --once`.

## Workflow: one-off / scheduled send (no campaign)

```bash
# immediate (optionally CC someone)
npm run mq -- send --provider gmail --to a@b.com --cc boss@co.com --subject "Hi" --body "..."
# schedule 30 min out (Mode 2 — fires with the app closed)
npm run mq -- send --provider gmail --to a@b.com --subject "Hi" --body "..." --in 30
# schedule at an absolute time
npm run mq -- send --provider outlook --to a@b.com --subject "Hi" --body-file b.txt --at 2026-07-01T09:00
```

`send` does NOT log or write contact history — it's a raw send. For tracked outreach use a campaign.

## Verification discipline (do this, it has caught real bugs)

- After any send, if correctness matters, **confirm real delivery** — don't rely on `status:"sent"`.
  If a Gmail tool/MCP is available and the recipient is a Gmail address, search for the unique
  subject; otherwise ask the user to confirm receipt.
- Give each smoke test a **unique subject** (the CLI stamps an ISO timestamp) so you can find it.
- For **scheduled** sends: the email won't arrive until the scheduled time. Verify it's queued
  (Gmail `in:scheduled`, Outlook Drafts, Zoho Outbox), then **wait until after the scheduled
  minute** and confirm delivery. Checking early is not a failure.
- Providers enforce a minimum schedule lead time (Gmail/Outlook accept ~3 min; Zoho's presets
  start at 10 min but its custom picker accepted a few minutes). For real use this is irrelevant
  (schedule hours/days out); it only matters for fast testing.

## Recovering a paused campaign

```bash
npm run mq -- --json campaign show <id>     # read lastError
```
- `lastError` mentions **captcha / security_warning / account_locked** → STOP. Tell the user to
  resolve it in the browser themselves. Do NOT auto-resume or try to bypass it.
- `logged_out` → the session expired; run `provider login <p>` again, then `campaign resume`.
- "Paused after 3 consecutive failures" → inspect `campaign recipients <id> --status failed` for the
  reason. If it's a selector break, follow drift recovery below. Then `campaign retry` + `resume`.

## When a provider's web UI changes (selectors break) → fix + PR

Providers (especially the new Outlook) change their DOM, so compose/attach/send/schedule steps
break periodically. **The standing instruction is: when this happens, fix the code and open a PR**
(branch, never push to `main`). Short version:

1. Reproduce: `npm run mq -- --json provider test <p>` — the Playwright error names the stale
   locator and what it wrongly matched.
2. Introspect the live DOM with the `scripts/inspect*.ts` aids (they dump real roles/labels/values
   and screenshot to `/tmp/*.png`).
3. Fix `providers/<p>.ts` with stable selectors (role+exact name > `getByLabel` > `data-testid` >
   placeholder; avoid CSS classes and broad regexes).
4. Verify: `npx tsc --noEmit` + `npm run mq -- --json provider test <p>` (add `--attach`/`--in` if
   relevant) → `status:"sent"`, ideally confirm real delivery.
5. Branch → commit → push → `gh pr create`; report the PR URL to the user.

**Read `reference/drift-recovery.md` for the full playbook with real examples, and
`reference/providers.md` for the current working selector map per provider.**

## Troubleshooting (common errors)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Invalid db.* invocation` / can't open DB | DB not migrated / wrong CWD | `npm run prisma:migrate`; run from repo root (or use linked `mailqueue`). |
| `browserType.launch: Executable doesn't exist` | Chromium not installed | `npx playwright install chromium`. |
| `provider test` returns `logged_out`/`captcha` and hangs ~5 min | not logged in / challenge | `provider login <p>` and complete it manually; never bypass a challenge. |
| Locator matched the wrong element (e.g. "To Do") | broad selector after UI change | drift recovery — use exact accessible names. |
| `status:"sent"` but nothing arrives | false-positive verify, or scheduled (not yet due) | confirm via real delivery; for scheduled, wait past the time. |
| `start` exits code 5 | 0 recipients or missing/oversized attachment | import a CSV / fix the attachment path, re-`preview`. |
| Zoho send "succeeds" but compose stays open | post-attachment-modal Send no-op | already handled (Cmd/Ctrl+Enter retry); if it regresses, see providers ref. |

## Boundaries — decline these

No bypassing CAPTCHA/2FA/security challenges, no account rotation to dodge limits, no identity
spoofing, no inbox scraping, no purchased lists, no abusive volumes/speeds, no continuing after a
provider security warning. If asked, decline and explain MailQueue's consensual-outreach purpose.
