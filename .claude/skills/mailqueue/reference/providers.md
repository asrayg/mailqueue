# Provider selector map & quirks

This is the **known-good selector map** for each provider's web UI, plus the quirks that have
already bitten us. When a step breaks, compare reality (via `scripts/inspect*.ts`) against this and
update `providers/<provider>.ts`. Selectors live in `providers/{gmail,outlook,zoho}.ts`; the shared
orchestration + safety gate is in `providers/base.ts` and `providers/browser.ts`.

## Selector philosophy (apply everywhere)

Prefer, in order:
1. ARIA role + **exact** accessible name: `getByRole('button', { name: 'Send', exact: true })`.
2. `getByLabel('To', { exact: true })` (matches `aria-label`, `<label for>`, `aria-labelledby`).
3. `data-testid` / `data-test-id` (e.g. Zoho `[data-testid="com_send_later"]`).
4. `getByPlaceholder('Subject', { exact: true })`.

Avoid: churning CSS classes (Outlook/Zoho use atomic hashed classes like `___77lcry0`), and broad
regexes that match unrelated elements. **The classic trap:** `/^to/i` matched Outlook's "To Do"
app-rail icon and Zoho's "Go to Mail" link instead of the recipient field — always use exact names.

Rich-text editors are often in an **iframe**: `page.frameLocator('iframe[title="..."]').locator('body')`.

## Safety detection (providers/browser.ts)

`detectSafetySignals(page, { expectedHostIncludes })` must NOT keyword-scan the inbox (email
subjects like "Security alert" caused false positives that paused campaigns before composing). It
detects real walls by **URL** (redirect to `accounts.google.com` / `login.live.com` / `challenge` /
`select_account` / `/login`) and **CAPTCHA iframes** only. `expectedHostIncludes` per provider:
Gmail `mail.google.com`, Outlook `outlook.` (covers office.com/live.com/cloud.microsoft), Zoho
`mail.zoho.`. Keep this URL/iframe-based — do not regress to body-text scanning.

---

## Gmail (`providers/gmail.ts`) — mailbox `https://mail.google.com/mail/u/0/#inbox`

| Step | Selector |
| --- | --- |
| Compose | `getByRole('button', { name: /compose/i })` |
| Dialog | `getByRole('dialog')` |
| To | `dialog.getByRole('combobox', { name: /to recipients\|to/i })` → fill → `Tab` |
| CC | reveal first: `dialog.getByRole('link', { name: /add cc recipients/i })` (it's a **link**, not a button), then `dialog.getByRole('combobox', { name: /cc recipients/i })` → fill each + `Enter` |
| BCC | reveal: `dialog.getByRole('link', { name: /add bcc recipients/i })`, then `dialog.getByRole('combobox', { name: /bcc recipients/i })` → fill each + `Enter` |
| Subject | `dialog.getByRole('textbox', { name: /subject/i })` |
| Body | `dialog.getByRole('textbox', { name: /message body/i })` |
| Attach | "Attach files" button triggers a `filechooser`; wait for `/uploading/i` to go hidden |
| Send | `dialog.getByRole('button', { name: /^send/i })` |
| Verify sent | **the "Undo" link or `^Message sent`** — NOT the transient "Sending..." toast (false positive) |
| Schedule | "More send options" → menuitem "Schedule send" → "Pick date & time" → calendar gridcell `"24 Jun"` + `textbox "Time"` (`"8:23 PM"`) → button `"Schedule send"` (exact) |

Notes: Gmail class names churn — rely on roles. The Date/Time custom picker uses gridcell names like
`"24 Jun"` (`dayMonthCell()` in `lib/time.ts`) and a 12h time string (`format12hTime()`). Verified:
schedule send delivers at the scheduled minute with the browser closed; queued items show in
`in:scheduled`.

## Outlook (`providers/outlook.ts`) — mailbox `https://outlook.office.com/mail/`

**Host quirk (important):** default to `outlook.office.com` (work/school accounts; redirects to
`outlook.cloud.microsoft`). Personal accounts use `outlook.live.com` and must set
`OUTLOOK_MAILBOX_URL=https://outlook.live.com/mail/0/`. Pointing a work account at `live.com` lands
on an account picker (`?prompt=select_account`).

| Step | Selector |
| --- | --- |
| Compose | New-Outlook ribbon button is just **"New"** (not "New mail"): try `/new mail/i`, `/new message/i`, then `/^new$/i`; handle an optional dropdown menuitem `/mail\|email/i` |
| To | `getByLabel('To', { exact: true })` — a contenteditable `div`, exact label avoids "To Do". After fill+Enter, press **`Escape`** to close the people-picker popup so it can't overlay Cc/Subject |
| CC | `getByLabel('Cc', { exact: true })` (inline contenteditable div) → fill each + `Enter`, then `Escape` |
| BCC | reveal: `getByRole('button', { name: 'Bcc', exact: true })`, then `getByLabel('Bcc', { exact: true })` → fill each + `Enter`, then `Escape` |
| Subject | `getByRole('textbox', { name: 'Subject', exact: true })` (an `<input>`) |
| Body | `getByRole('textbox', { name: 'Message body' })` |
| Attach | button `/attach file/i` → menu `/browse this computer\|this computer\|upload from/i` triggers the `filechooser` |
| Send | `getByRole('button', { name: 'Send', exact: true })` |
| Verify sent | compose closes → wait for the Send button to be hidden |
| Schedule | "More send options" → menuitem "Schedule send" → button "Custom time" → dialog `/custom date and time/i` with two unlabeled comboboxes (identify by value: date `M/D/YYYY`, time `h:mm AM/PM`) → dialog "Send" |

Notes: Outlook is slower — use longer timeouts. The schedule dialog's date/time fields have no
aria-labels; find them by value format among the dialog's comboboxes. Verified end-to-end (compose,
attach PNG+PDF, schedule). Watch for false "didn't deliver" conclusions when verifying a scheduled
send too early.

## Zoho (`providers/zoho.ts`) — mailbox `https://mail.zoho.com/zm/`

| Step | Selector |
| --- | --- |
| Compose | `getByRole('button', { name: /new mail\|compose/i })` |
| To | `getByRole('combobox', { name: /to recipients/i })` → fill → `Enter`. **Do NOT press `Escape`** (see below) |
| CC | `getByRole('combobox', { name: /cc recipients/i })` → fill each + `Enter`. No Escape |
| BCC | reveal: `getByRole('button', { name: /add bcc recipients/i })` (a `<font role=button>`), then `getByRole('combobox', { name: /bcc recipients/i })` → fill each + `Enter`. No Escape |
| Subject | `getByPlaceholder('Subject', { exact: true })` — use **`fill()` without a preceding `click()`** (a recipient popup can overlay it) |
| Body | **inside an iframe**: `frameLocator('iframe[title="Text editor area"], iframe.ze_area').locator('body')` → **`focus()`** (not click) → `ControlOrMeta+a` → type. (`#wms-pasteCapture` is a 0×0 decoy — do not target it.) |
| Attach | button `"Attachment"` (exact) opens a **modal** → button `/upload files/i` triggers `filechooser` → button `"Attach"` (exact) confirms; wait for the modal to close |
| Send | `getByRole('button', { name: 'Send', exact: true })`; if compose stays open after a modal interaction, retry with `ControlOrMeta+Enter`, then re-click |
| Verify sent | Send button hidden OR a `/message has been sent\|mail sent\|sent successfully/i` toast |
| Schedule | button `[data-testid="com_send_later"]` → "Schedule" tab → text "Custom Date and Time" → date dropdown (`MM/DD/YYYY`, defaults to today) + **24h** spinbuttons `getByRole('spinbutton', { name: 'Hour'\|'Minute' })` → button `/schedule and send/i` |

Notes: Zoho layout varies by theme/account, so keep fallbacks. Real bugs already fixed here: the body
editor is in the `ze_area` iframe (not the `wms-pasteCapture` div); the post-attachment Send could
silently no-op (fixed with the Cmd/Ctrl+Enter retry in `uiSend`); and — **critical** — pressing
`Escape` anywhere in Zoho compose pops a modal (`zmCompPortalWrapper`) that overlays the entire form
(including Send) and blocks everything. So Zoho compose must NEVER press `Escape`; instead reach
Subject via `fill()` and the body via `focus()` (no pointer clicks the recipient popup could
intercept), which keeps it working even with CC's suggestion popup open. Zoho's soonest schedule
preset is 10 minutes; the custom picker accepted a few minutes. 24-hour Hour/Minute, account-local tz.

---

## The introspection scripts (`scripts/`)

These open compose against the saved session and dump real roles/aria-labels/values + screenshot to
`/tmp/*.png`. Clone the closest one for the surface you need.

- `inspectOutlook.ts`, `inspectZoho.ts` — compose fields/buttons.
- `inspectGmailSchedule.ts`, `inspectOutlookSchedule.ts`, `inspectZohoSchedule.ts` — schedule dialogs.

Generic dump you can paste into a new probe after opening the relevant surface:
```js
const fields = await page.$$eval(
  'input,[role=combobox],[role=spinbutton],[role=textbox],[contenteditable=true],button,[role=button]',
  els => els.filter(e => e.offsetParent).map(e => ({
    tag: e.tagName.toLowerCase(), role: e.getAttribute('role'),
    name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40),
    value: e.value, placeholder: e.getAttribute('placeholder'),
    testid: e.getAttribute('data-testid') })));
console.log(JSON.stringify(fields, null, 2));
await page.screenshot({ path: '/tmp/probe.png' });
```
For iframe editors, also list frames: `page.frames().map(f => ({ url: f.url() }))` and dump inside the
candidate frame with `frame.$$eval(...)`.
