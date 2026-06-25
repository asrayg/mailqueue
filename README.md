# MailQueue

[![CI](https://github.com/asrayg/mailqueue/actions/workflows/ci.yml/badge.svg)](https://github.com/asrayg/mailqueue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Controlled, scheduled, multi-provider email outreach via browser automation.

MailQueue sends the same (or lightly personalized) email to many recipients
across **Gmail, Outlook, and Zoho Mail** — gradually, within a sending window,
with randomized delays and hard caps — instead of blasting everyone at once.
It drives the real web UI through **Playwright** using your own logged-in
session, so there are no SMTP passwords and no API keys.

> **This is for legitimate cold outreach and follow-ups — not spam.** MailQueue
> never bypasses CAPTCHAs, 2FA, or provider anti-abuse systems. If it detects a
> CAPTCHA, security warning, logout, or repeated failures, it **pauses** the
> campaign.

---

## Features

- Gmail / Outlook / Zoho via a clean **provider adapter** pattern
- CSV import with validation, de-duplication, and `{{variable}}` templating
- **Preview + explicit confirmation** before anything sends
- **Test-send to yourself** before a real campaign
- Gradual scheduler: sending window, per-hour/per-day caps, randomized delays
- Duplicate prevention (in-campaign + cross-campaign contact history)
- Pause / resume / cancel / retry-failed, full send log + CSV export
- Auto-pause on CAPTCHA, security warning, logout, or 3 consecutive failures

## Tech stack

Next.js (App Router) · TypeScript · Playwright · SQLite + Prisma · Tailwind ·
Zod · PapaParse.

---

## Quick start

```bash
npm install
npx playwright install chromium
cp .env.example .env          # set TEST_RECIPIENT_EMAIL to your address
npm run prisma:migrate        # creates the SQLite DB
```

Run the dashboard and the worker in two terminals:

```bash
npm run dev      # http://localhost:3000
npm run worker   # the process that actually sends, gradually
```

> Mode 1 (app-controlled scheduling) is the default: the **worker must stay
> running** for emails to go out. **Mode 2 (provider-native "Schedule send" /
> "Send later")** is also implemented at the provider layer and validated on all
> three providers — pass a `scheduleAt` to the adapter and the mail goes out at
> that time even with the app closed. (Wiring Mode 2 into campaign scheduling
> from the dashboard is the next integration step.)

### First-time provider login

The first time you use a provider, a real browser window opens. **Log in
manually** (including 2FA) — MailQueue then reuses that persistent session from
`browser-profiles/<provider>/`. Passwords are never stored.

Smoke-test a provider end to end:

```bash
npm run test:gmail                              # or test:outlook / test:zoho
npx tsx scripts/testProvider.ts gmail a.png b.pdf   # with attachments
npx tsx scripts/testProvider.ts gmail --in=10       # schedule-send 10 min out (Mode 2)
```

---

## CLI

Everything the dashboard does is available from the terminal via `mailqueue`.
`npm install` runs a `postinstall` that best-effort `npm link`s the CLI so
`mailqueue <args>` works from any directory (set `MQ_NO_LINK=1` to skip, or run
`npm link` yourself; `npm run mq -- <args>` always works without linking). The
global command resolves the project's DB, sessions, and uploads by absolute path,
so it works from anywhere. Every command accepts `--json` for machine-readable
output.

```bash
# log in once per provider (opens a browser; session is saved)
npm run mq -- provider login gmail

# create → preview → test → start
npm run mq -- --json campaign create --name "Q3 shops" --provider gmail \
  --subject "Quick question about {{company}}" --body-file body.txt \
  --csv contacts.csv --attach deck.pdf --cc colleague@yourco.com \
  --max-per-day 25 --delay 300-900
npm run mq -- --json campaign preview <id>      # rendered emails + blockers
npm run mq -- campaign test <id> --to me@x.com  # one test email
npm run mq -- --json campaign start <id>
npm run mq -- worker                            # dispatch gradually (keep running)

# one-off / scheduled send, no campaign
npm run mq -- send --provider gmail --to a@b.com --subject Hi --body "..." --in 30
```

Command groups: `campaign {create,list,show,preview,import,recipients,test,start,
pause,resume,cancel,retry,logs}`, `provider {login,test}`, `send`, `worker`.
Run `npm run mq -- --help` (or `... <command> --help`) for full flags.

### Claude Code skill

This repo ships a [`mailqueue` skill](.claude/skills/mailqueue/SKILL.md) so Claude
Code can drive the CLI safely: the standard create→preview→test→start workflow,
`--json` parsing, and — when a provider's web UI changes and selectors break — a
**recover-and-PR** workflow (reproduce → introspect the live DOM with the
`scripts/inspect*.ts` aids → fix `providers/<p>.ts` → verify with `provider test`
→ open a PR with `gh`). It will not bypass CAPTCHA/2FA or other anti-abuse systems.

---

## Typical flow (dashboard)

1. **New Campaign** — name, provider, subject, body, attachments, CSV, sending
   window, caps, delay range.
2. **Preview** — recipient count, attachments, first 5 generated emails, missing
   variable warnings, estimated finish.
3. **Send Test Email** to yourself.
4. **Confirm and Start.**
5. Watch the **dashboard**: pending / scheduled / sent / failed / skipped,
   next-send estimate, per-recipient status, live log, and pause/resume/cancel.

### CSV format

Requires an `email` column. Optional: `first_name`, `last_name`, `company`, and
any extra columns (available as `{{column_name}}`). See
[`examples/contacts.sample.csv`](examples/contacts.sample.csv).

### Template variables

`{{first_name}}`, `{{company}}`, `{{email}}`, plus any CSV column. Missing
variables render blank and are flagged on the preview screen before you confirm.

---

## Safety defaults

| Setting        | Standard | New account |
| -------------- | -------- | ----------- |
| Max per hour   | 10       | 5           |
| Max per day    | 50       | 25          |
| Min delay      | 180s     | 300s        |
| Max delay      | 900s     | 1200s       |

Default sending window: **Mon–Fri, 09:00–16:30, America/Chicago**. No overnight
or weekend sending unless you change it.

MailQueue **will not**: bypass CAPTCHAs or 2FA, rotate accounts to evade limits,
scrape inboxes, send to invalid/duplicate/already-contacted addresses, or
continue after a provider warning.

---

## Project layout

```
app/                 Next.js pages + server actions
  campaigns/         list · new · [id] dashboard · [id]/preview · [id]/logs export
cli/                 mailqueue CLI (index.ts commands · util · providerSend)
bin/mailqueue.js     CLI launcher (runs cli/index.ts via tsx)
lib/                 db, csv, templates, validation, limits, time, hashing, scheduler
providers/           types · base · gmail · outlook · zoho · index (adapter pattern)
worker/sendWorker.ts the gradual send loop (Mode 1)
prisma/schema.prisma Campaign · Recipient · SendLog · GlobalContactHistory
scripts/             provider smoke tests + inspect*.ts DOM-introspection dev aids
.claude/skills/      mailqueue Claude Code skill
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dashboard |
| `npm run mq -- <args>` | The MailQueue CLI (`--help` for commands) |
| `npm run worker` | Gradual send worker (must run to send) |
| `npm run prisma:migrate` | Apply DB migrations |
| `npm run test:gmail` / `:outlook` / `:zoho` | Provider smoke test |

## Roadmap

- Wire Mode 2 (provider-native schedule-send, already implemented + validated at
  the provider layer) into per-recipient campaign scheduling from the dashboard
- v2 follow-ups (skip on reply / not-interested, max one by default)

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If a provider's
web UI changes and breaks the automation, the fix is usually a selector update in
`providers/<provider>.ts`: use the `scripts/inspect*.ts` DOM-introspection aids to
find the new selectors, verify with `npm run mq -- provider test <provider>`, and
open a PR. There's a dedicated **"Provider UI changed"** issue template.

## License

[MIT](LICENSE) © Asray Gopa.

> Use responsibly. MailQueue is for consensual, legitimate outreach and
> follow-ups. Do not use it to send spam, and do not modify it to bypass email
> providers' anti-abuse systems (CAPTCHA, 2FA, rate limits). You are responsible
> for complying with anti-spam laws (e.g. CAN-SPAM, GDPR) and each provider's
> Terms of Service.
