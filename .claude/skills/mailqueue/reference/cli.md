# MailQueue CLI — full reference

Invoke as `npm run mq -- <args>` (repo root) or `mailqueue <args>` (if linked). Put `--json`
immediately after the program name. All commands print a JSON object with `ok: true|false` in
`--json` mode; errors are `{"ok":false,"error":"..."}` with a non-zero exit.

**Exit codes:** `0` ok · `2` send failed · `4` campaign not found · `5` start refused (blockers) ·
`1` other error.

**Global flag:** `--json` — machine-readable output. Without it you get terse human text.

---

## `campaign create`

Create a draft campaign. Flags override a `--config` JSON file.

| Flag | Meaning |
| --- | --- |
| `--config <file>` | JSON file with any of the keys below (`name`, `provider`, `subject`, `body`, `csv`, `attachments`, `window`, `timezone`, `days`, `maxPerHour`, `maxPerDay`, `delay`, `recontact`). |
| `--name <s>` | Campaign name (required). |
| `--provider <gmail\|outlook\|zoho>` | Provider (required). |
| `--subject <s>` | Subject template (supports `{{vars}}`). |
| `--body <s>` / `--body-file <f>` | Body template. Prefer `--body-file` for multiline. |
| `--csv <f>` | Recipients CSV (needs `email` column). |
| `--attach <f...>` | One or more attachment paths (verified to exist). |
| `--window <HH:MM-HH:MM>` | Sending window, local to `--tz`. Default `09:00-16:30`. |
| `--tz <IANA>` | Timezone. Default `America/Chicago`. |
| `--days <spec>` | `weekdays`\|`mon-fri`\|`mon-sat`\|`all`\|`everyday` or CSV ints `1,2,3,4,5` (0=Sun..6=Sat). Default weekdays. |
| `--max-per-hour <n>` | Hourly cap. Default 10. |
| `--max-per-day <n>` | Daily cap. Default 50. |
| `--delay <MIN-MAX>` | Delay range seconds, e.g. `300-900`. Default `180-900`. |
| `--recontact <30\|60\|90\|never>` | Skip anyone contacted within N days (global). Default 30. |

Output:
```json
{ "ok": true, "id": "cmq...", "name": "Q3 shops", "provider": "gmail", "status": "draft",
  "recipientsImported": 42,
  "csv": { "valid": 42, "duplicateRows": 3, "invalidRows": 1 },
  "nextStep": "mailqueue campaign preview cmq..." }
```
Safe defaults for a NEW sending account: `--max-per-hour 5 --max-per-day 25 --delay 300-1200`.

---

## `campaign list`
All campaigns, newest first, with per-status counts.
```json
{ "ok": true, "campaigns": [
  { "id": "cmq...", "name": "...", "provider": "gmail", "status": "running",
    "recipients": 42, "sent": 10, "failed": 0, "skipped": 2, "pending": 30,
    "createdAt": "2026-..." } ] }
```

## `campaign show <id>`
Full config + stats + `lastError`.
```json
{ "ok": true, "id": "...", "name": "...", "provider": "gmail", "status": "paused",
  "subject": "...", "window": "09:00-16:30 America/Chicago", "sendDays": [1,2,3,4,5],
  "caps": { "maxPerHour": 10, "maxPerDay": 25 }, "delaySeconds": { "min": 300, "max": 900 },
  "recontactAfterDays": 30, "attachments": ["/abs/path.pdf"], "consecutiveFailures": 3,
  "lastError": "Serious error: security_warning: ...",
  "stats": { "pending": 30, "scheduled": 0, "sent": 10, "failed": 0, "skipped": 2, "total": 42 } }
```

## `campaign preview <id> [--limit N]`
Render the first N emails (default 5) + go/no-go checks. **Show this to the user before starting.**
```json
{ "ok": true, "id": "...", "recipients": 42,
  "attachments": [ { "path": "/abs/deck.pdf", "exists": true, "tooLarge": false } ],
  "missingVars": ["company"], "estimatedFinish": "2026-07-01 16:30 CDT",
  "previews": [ { "email": "x@y.com", "subject": "...", "body": "...", "missingVars": [] } ],
  "startBlockers": [], "canStart": true }
```
`canStart` is false (and `start` will refuse) when there are 0 recipients or any missing/oversized
attachment. `missingVars` lists template variables that render blank for the previewed recipients.

## `campaign import <id> --csv <f>`
Add recipients to an existing campaign (skips emails already present).
```json
{ "ok": true, "imported": 12, "duplicateRows": 1, "invalidRows": 0 }
```

## `campaign recipients <id> [--status <s>] [--limit N]`
List recipients (default limit 200). `--status` ∈ `pending|scheduled|sent|failed|skipped`.
```json
{ "ok": true, "count": 2, "recipients": [
  { "email": "x@y.com", "status": "failed", "sentAt": null, "failureReason": "..." } ] }
```

## `campaign test <id> [--to <email>]`
Send ONE test email using the first recipient's variables (or stub values). Recipient = `--to` or
`TEST_RECIPIENT_EMAIL`. **Opens a browser.** Never writes contact history.
```json
{ "ok": true, "testSentTo": "user@theirdomain.com" }
```

## `campaign start <id>`
Confirm → `running`. **Refuses (exit 5)** on 0 recipients or missing/oversized attachments.
```json
{ "ok": true, "id": "...", "status": "running", "recipients": 42,
  "note": "Run `mailqueue worker` to dispatch sends." }
```

## `campaign pause|resume|cancel <id>`
Lifecycle transitions. `resume` clears `lastError` + `consecutiveFailures`.
```json
{ "ok": true, "id": "...", "status": "paused" }
```

## `campaign retry <id>`
Reset `failed` recipients → `pending` and clear the failure counter so the worker retries them.
```json
{ "ok": true, "requeued": 3 }
```

## `campaign logs <id> [--out <file.csv>]`
With `--out`: write a CSV file. Without: JSON to stdout.
```json
{ "ok": true, "logs": [
  { "createdAt": "2026-...", "email": "x@y.com", "status": "sent", "subject": "...", "error": null } ] }
```

---

## `provider login <gmail|outlook|zoho>`
Open the provider in a browser and hold it ~2 min so the user logs in once; the session persists in
`browser-profiles/<provider>/`. `{ "ok": true, "provider": "gmail" }`.

## `provider test <gmail|outlook|zoho> [--to <email>] [--attach <f...>] [--in <min>]`
End-to-end smoke test: opens the mailbox (waits up to 5 min for first-time login), sends a uniquely
timestamped email. `--attach` exercises attachments; `--in N` exercises Mode 2 scheduling.
```json
{ "ok": true, "provider": "gmail", "to": "you@example.com", "success": true, "status": "sent" }
```
On failure: `success:false`, `status:"failed"`, `error:"..."`, exit 2. `serious:true` means a safety
signal (captcha/security/logout) — do not retry blindly.

---

## `send` (one-off, no campaign, no logging)
```
send --provider <p> --to <email> --subject <s> (--body <s> | --body-file <f>)
     [--attach <f...>] [--in <min> | --at <iso>]
```
`--in N` schedules N minutes out; `--at <iso>` schedules at an absolute datetime (both Mode 2).
```json
{ "ok": true, "provider": "gmail", "to": "a@b.com", "scheduledAt": "2026-07-01T14:00:00.000Z",
  "success": true, "status": "scheduled" }
```

## `worker [--once]`
Dispatch all `running` campaigns. Default: loop forever (60s poll; sleeps a randomized delay after
each send). `--once`: a single pass over running campaigns, then exit — handy for tests and CI-ish
checks (it still respects window/caps; it just doesn't sleep the long delay).
```json
{ "ok": true, "results": [ { "id": "...", "name": "...", "sent": true } ] }
```
Per-result `reason` values when not sent: `outside-window`, `daily-cap`, `hourly-cap`, `delay`,
`skipped`, `completed`.

---

## Scheduling argument formats
- `--in <n>`: integer minutes from now (e.g. `--in 30`, `--in 1440` for a day).
- `--at <iso>`: any `Date`-parseable datetime, interpreted in the machine's local timezone
  (e.g. `--at 2026-07-01T09:00`). Must be in the future and above the provider's minimum lead time.

## Config-file campaign create (alternative to flags)
```json
{ "name": "Q3 shops", "provider": "gmail",
  "subject": "Quick question about {{company}}", "body": "Hi {{first_name}}, ...",
  "csv": "contacts.csv", "attachments": ["deck.pdf"],
  "window": "09:00-16:30", "timezone": "America/Chicago", "days": "weekdays",
  "maxPerHour": 10, "maxPerDay": 25, "delay": "300-900", "recontact": 30 }
```
`npm run mq -- --json campaign create --config campaign.json` (flags still override).
