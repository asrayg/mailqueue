# Contributing to MailQueue

Thanks for helping improve MailQueue! This guide covers local setup, the coding
conventions, and — most importantly — how to fix a provider when its web UI
changes.

## Ground rules

MailQueue is for **consensual, legitimate outreach and follow-ups**. Contributions
must keep its safety guarantees intact. We will **not** accept changes that:

- bypass CAPTCHAs, 2FA, or any provider anti-abuse system;
- rotate accounts to evade sending limits, or hide identity;
- remove the auto-pause safeguards (CAPTCHA / security warning / logout / repeated
  failures) or the duplicate-prevention / rate-limit logic;
- scrape inboxes or enable sending to purchased/non-consensual lists.

## Local setup

```bash
npm install
npx playwright install chromium
cp .env.example .env          # set TEST_RECIPIENT_EMAIL to an address you own
npm run prisma:migrate        # creates prisma/dev.db
```

Run things:

```bash
npm run dev                   # Next.js dashboard at http://localhost:3000
npm run worker                # the gradual send worker (Mode 1)
npm run mq -- --help          # the CLI
npm run mq -- provider test gmail   # smoke-test a provider end to end
```

First use of a provider opens a real browser — **log in manually**; the session
is saved to `browser-profiles/<provider>/` (git-ignored, never commit it).

## Before you open a PR

```bash
npx tsc --noEmit     # must pass
npm run build        # must pass
```

CI runs both on every PR. If you touched a provider or the send path, also run
the relevant `provider test` and, ideally, confirm the email actually arrived
(provider "sent" toasts have given false positives — verify real delivery).

## Project layout

| Path | What |
| --- | --- |
| `providers/` | Provider adapter pattern: `types`, `base`, `gmail`, `outlook`, `zoho`, `browser`. |
| `lib/` | `db`, `csv`, `templates`, `validation`, `limits`, `time`, `hashing`, `scheduler`, `campaignService`. |
| `cli/` | The `mailqueue` CLI (`index.ts`, `util.ts`, `providerSend.ts`). |
| `app/` | Next.js dashboard + server actions. |
| `worker/sendWorker.ts` | The gradual send loop. |
| `scripts/inspect*.ts` | DOM-introspection dev aids (used to find selectors). |

## Fixing a provider when its web UI changes (the common case)

Providers churn their DOM, so a step (compose / attach / send / schedule) will
periodically break. The fix is almost always a **selector update** in
`providers/<provider>.ts`. Workflow:

1. **Reproduce and read the error.**
   ```bash
   npm run mq -- --json provider test gmail
   ```
   Playwright names the locator and what it resolved to (e.g. `/^to/i` matched
   `aria-label="To Do"`). That points at the stale selector.

2. **Introspect the live DOM** with the dev aids (clone the closest one for the
   step you need — they open compose against your saved session and dump
   roles/aria-labels/values + screenshot to `/tmp/*.png`):
   - `scripts/inspectOutlook.ts`, `scripts/inspectZoho.ts` — compose fields
   - `scripts/inspectGmailSchedule.ts`, `scripts/inspectOutlookSchedule.ts`,
     `scripts/inspectZohoSchedule.ts` — schedule-send dialogs

3. **Fix `providers/<provider>.ts`.** Prefer stable selectors in this order:
   ARIA role + exact accessible name (`getByRole('button', { name: 'Send', exact: true })`),
   `getByLabel`, `data-testid`, placeholder. Avoid CSS classes and broad regexes
   that can match unrelated elements (the "To Do" trap). Editors are sometimes in
   an iframe (`page.frameLocator('iframe[title="..."]').locator('body')`).

4. **Verify** — `npx tsc --noEmit`, then `npm run mq -- --json provider test <provider>`
   (add `--attach`/`--in` if you changed attachments/scheduling). Confirm
   `status: "sent"` and, if you can, real delivery.

5. **Open a PR** against `main` describing the DOM change and the new selector.

## Commit & PR conventions

- Branch off `main`: `fix/outlook-compose-selectors`, `feat/cli-export`, etc.
- Write imperative commit subjects ("Fix Zoho attach modal flow").
- Keep PRs focused; fill in the PR template (verification checklist included).
- Don't commit `browser-profiles/`, `.env`, `uploads/`, or `prisma/*.db` (all
  git-ignored).

## Reporting issues

Use the issue templates — there's a dedicated **"Provider UI changed"** template
for selector breakage. Never paste real recipient data, cookies, or credentials.
