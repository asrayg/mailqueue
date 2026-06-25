---
name: mailqueue
description: >-
  Drive the MailQueue CLI to send controlled, scheduled, multi-provider cold-outreach
  / follow-up emails through Gmail, Outlook, or Zoho (Playwright browser automation, no
  SMTP). Use when the user wants to create/preview/start/pause an email campaign, import a
  CSV of recipients, send a one-off or scheduled ("send later") email, run the send worker,
  send a test email, or when a provider's web UI changed and the automation selectors need
  fixing + a PR. Not for transactional email or SMTP/API sending.
---

# MailQueue CLI

MailQueue sends the same (or `{{variable}}`-personalized) email to many recipients,
**gradually** — within a sending window, under hourly/daily caps, with randomized delays —
by driving the provider's real web UI via Playwright using the user's own logged-in session.

**This is for legitimate outreach, not spam.** Never help bypass CAPTCHAs, 2FA, or provider
anti-abuse systems; never rotate accounts to evade limits. MailQueue auto-pauses on CAPTCHA,
security warnings, logout, or repeated failures — keep it that way.

## Golden rules

1. **Always pass `--json`** and parse it. Every command prints a JSON object with `ok: true/false`.
2. **Never start a real campaign without `campaign preview` first**, and prefer sending a
   `campaign test` to the user first. Surface recipient count, duplicates, invalid emails,
   missing template vars, and attachment problems before starting.
3. **The worker must run for app-controlled sends to go out** (`mailqueue worker`). For
   provider-native scheduling that fires with the app closed, use `--in`/`--at` (Mode 2).
4. Run from the repo root. If commands fail with a DB error, run `npm run prisma:migrate`.
   If Playwright errors about a missing browser, run `npx playwright install chromium`.

## Invocation

```bash
npm run mq -- <args>          # e.g. npm run mq -- --json campaign list
# or, if linked:  mailqueue <args>
```

## Command reference (all accept `--json`)

| Command | Purpose |
| --- | --- |
| `campaign create` | Create a draft. Flags: `--name --provider --subject --body\|--body-file --csv --attach <files...> --window HH:MM-HH:MM --tz --days weekdays\|all\|1,2,5 --max-per-hour --max-per-day --delay MIN-MAX --recontact 30\|60\|90\|never`. Also `--config file.json`. |
| `campaign list` | All campaigns + per-status counts. |
| `campaign show <id>` | Config, stats, last error. |
| `campaign preview <id> [--limit N]` | First N rendered emails, missing vars, attachment checks, `canStart`/`startBlockers`. |
| `campaign import <id> --csv f` | Add recipients to an existing campaign. |
| `campaign recipients <id> [--status pending\|sent\|failed\|...]` | Per-recipient status. |
| `campaign test <id> [--to email]` | Send ONE test email (opens a browser). |
| `campaign start <id>` | Confirm → running. Refuses on 0 recipients or missing attachments. |
| `campaign pause\|resume\|cancel <id>` | Lifecycle. |
| `campaign retry <id>` | Requeue failed recipients → pending. |
| `campaign logs <id> [--out file.csv]` | Send log as JSON (stdout) or CSV file. |
| `provider login <gmail\|outlook\|zoho>` | Opens a browser; user logs in once (session saved to `browser-profiles/`). |
| `provider test <p> [--to] [--attach f...] [--in N]` | Smoke-test a provider end to end. |
| `send --provider <p> --to --subject --body\|--body-file [--attach f...] [--in N \| --at ISO]` | One-off send, no campaign/logging. |
| `worker [--once]` | Dispatch running campaigns. `--once` = single pass (good for testing). |

Exit codes: `0` ok, `2` send failed, `4` campaign not found, `5` start refused (blockers).

## Standard campaign workflow

```bash
# 1. First time only: log in to the provider (interactive browser).
npm run mq -- provider login gmail

# 2. Create from a CSV (needs an `email` column; optional first_name, company, ...).
npm run mq -- --json campaign create --name "Q3 shops" --provider gmail \
  --subject "Quick question about {{company}}" --body-file body.txt \
  --csv contacts.csv --attach deck.pdf --max-per-day 25 --delay 300-900

# 3. Preview — STOP and show the user. Check canStart + startBlockers.
npm run mq -- --json campaign preview <id>

# 4. Send the user a test, get their OK.
npm run mq -- campaign test <id> --to me@example.com

# 5. Start, then run the worker (keep it running to dispatch gradually).
npm run mq -- --json campaign start <id>
npm run mq -- worker
```

Monitor with `campaign show <id>` / `campaign recipients <id> --status failed`. If it
auto-pauses (`lastError` set), tell the user why and don't blindly resume.

## Schedule send (Mode 2 — fires with the app closed)

`--in <minutes>` or `--at <ISO>` on `send` / `provider test` uses the provider's native
"Schedule send" / "Send later". Verify by checking the provider's scheduled folder (Gmail
`in:scheduled`) or by confirming delivery at the scheduled time.

```bash
npm run mq -- send --provider gmail --to x@y.com --subject "Hi" --body "..." --in 30
```

## When a provider's web UI changes (selectors break) → fix + PR

Providers (esp. new Outlook) change their DOM, so a step like compose/attach/send/schedule
may start failing. **When that happens, fix the code and open a PR.** Workflow:

1. **Reproduce + read the error.**
   ```bash
   npm run mq -- --json provider test gmail   # note which step + selector failed
   ```
   Playwright errors name the locator and what it resolved to (e.g. `/^to/i` matched
   `aria-label="To Do"`). That tells you which selector in `providers/<p>.ts` is stale.

2. **Introspect the real DOM** with the dev-aid scripts (clone the closest one for the step
   you need — they open compose against the saved session and dump roles/aria-labels/values
   of fields + buttons, and screenshot to `/tmp/*.png`):
   - `scripts/inspectOutlook.ts`, `scripts/inspectZoho.ts` — compose fields.
   - `scripts/inspectGmailSchedule.ts`, `scripts/inspectOutlookSchedule.ts`,
     `scripts/inspectZohoSchedule.ts` — schedule-send dialogs.
   ```bash
   npx tsx scripts/inspectZoho.ts        # prints exact selectors; Read the /tmp screenshot
   ```
   To probe a new surface, copy one and dump:
   `page.$$eval('button,[role=button],input,[role=textbox],[contenteditable=true]', els => els.map(e => ({role:e.getAttribute('role'), name:e.getAttribute('aria-label')||e.textContent, value:e.value})))`.

3. **Fix `providers/<provider>.ts`.** Prefer stable selectors in this order: ARIA role +
   exact accessible name (`getByRole('button', { name: 'Send', exact: true })`), `getByLabel`,
   `data-testid`/`data-test-id`, placeholder. Avoid churning CSS classes and broad regexes
   that match unrelated elements (the "To Do" trap). Editors may be in an iframe
   (`page.frameLocator('iframe[title="..."]').locator('body')`).

4. **Verify** — `npx tsc --noEmit`, then `npm run mq -- --json provider test <provider>`
   (add `--attach` / `--in` if you touched attachments/scheduling). Confirm `status:"sent"`.
   If you can independently confirm delivery (e.g. a Gmail tool/inbox), do — provider "sent"
   toasts have given false positives before.

5. **Open a PR** (don't push to `main`):
   ```bash
   git checkout -b fix/<provider>-selectors-<short-desc>
   git add -A
   git commit -m "Fix <provider> <step> selectors after UI change

   <what changed in the DOM and the new selector>. Verified via provider test."
   git push -u origin HEAD
   gh pr create --title "Fix <provider> <step> selectors after UI change" \
     --body "The <provider> web UI changed and broke <step>. <root cause>. New selectors verified end-to-end via \`provider test\`."
   ```
   Tell the user the PR URL. Keep the throwaway inspect probe only if it's a reusable dev aid;
   otherwise delete it before committing.

## Safety boundaries (do not cross)

Don't bypass CAPTCHAs/2FA, hide identity, rotate accounts to dodge limits, scrape inboxes,
send to purchased lists, or continue after a provider security warning. If the user asks for
any of these, decline and explain MailQueue is for controlled, consensual outreach.
