# Provider UI drift recovery — playbook

**Standing instruction:** when a provider's web UI change breaks MailQueue's automation, fix the code
and **open a GitHub PR** (work on a branch; never push to `main`). This is the exact loop used to fix
Outlook and Zoho during initial development — it works.

## 0. Recognize it

Symptoms: `provider test` returns `success:false` with a Playwright error naming a locator; a campaign
auto-pauses with `lastError` like "Paused after 3 consecutive failures" and the failing recipients'
`failureReason` is a locator timeout / "Element is not an <input>…". A `serious:true` result that is
`captcha`/`security_warning`/`account_locked`/`logged_out` is NOT drift — that's a real wall; do not
"fix" it, tell the user to resolve it.

## 1. Reproduce + read the error

```bash
npm run mq -- --json provider test <provider>
# add --attach files / --in 10 if the broken step is attachments / scheduling
```

The error tells you the step and the stale selector, e.g.:
```
locator.fill: Element is not an <input>... 
  waiting for getByRole('textbox', { name: /^to/i })...
  locator resolved to <a aria-label="Go to Mail" ...>
```
→ the To selector is matching the wrong element after a DOM change.

## 2. Introspect the live DOM

Run the closest inspect script (see `reference/providers.md` for the list); Read its stdout AND the
`/tmp/*.png` screenshot it writes.

```bash
npx tsx scripts/inspectZoho.ts            # prints exact selectors; then Read /tmp/zoho-inspect-compose.png
```

If you need a surface no script covers, copy one and paste the generic dump snippet from
`reference/providers.md` after navigating/clicking to that surface. Look for: the exact `aria-label`,
`role`, `data-testid`, `placeholder`, and whether the field is inside an `iframe`.

## 3. Fix `providers/<provider>.ts`

Apply the selector philosophy (role+exact name > getByLabel > data-testid > placeholder; never broad
regex/CSS class). Keep one or two `.or(...)` fallbacks for resilience, but lead with the exact match.

## 4. Verify

```bash
npx tsc --noEmit
npm run mq -- --json provider test <provider>     # expect status:"sent"
```
If you touched attachments add `--attach /tmp/a.pdf`; if scheduling add `--in 10`. **Confirm real
delivery** if you can (Gmail tool / inbox / Scheduled folder) — the provider "sent" toast has lied
before. For scheduled tests, wait until past the scheduled minute before judging.

## 5. Open the PR

```bash
git checkout -b fix/<provider>-<step>-selectors
git add -A
git commit -m "Fix <provider> <step> selectors after UI change

The <provider> web UI changed: <old selector> now matches <wrong thing> / the
<field> moved to <new location>. Use <new stable selector>. Verified end-to-end
via \`provider test\` (+ real delivery)."
git push -u origin HEAD
gh pr create --fill --title "Fix <provider> <step> selectors after UI change" \
  --body "## What\n<provider>'s web UI changed and broke <step>.\n\n## Root cause\n<old> matched <wrong>.\n\n## Fix\n<new selector>.\n\n## Verification\n\`npm run mq -- --json provider test <provider>\` → sent; confirmed delivery."
```
Then **report the PR URL to the user.** Delete any throwaway probe script you created (keep it only if
it's a reusable dev aid like the existing `inspect*.ts`).

---

## Worked examples (these actually happened)

**Outlook — wrong host.** `provider test outlook` landed on an account picker
(`outlook.live.com/mail/?prompt=select_account`). Root cause: the account was work/school, which lives
on `outlook.office.com`. Fix: default `mailboxUrl` to office.com (+ `OUTLOOK_MAILBOX_URL` override for
personal). Lesson: check `page.url()` in the screenshot first.

**Outlook — "New" not "New mail".** Compose button in the new ribbon is labeled just "New". Fix: try
`/new mail/i`, `/new message/i`, then `/^new$/i`, plus an optional dropdown menuitem.

**Outlook — "To Do" trap.** `getByLabel(/^to/i)` matched the "To Do" app-rail icon. Fix:
`getByLabel('To', { exact: true })`.

**Zoho — body in an iframe.** The body selector hit `#wms-pasteCapture` (a 0×0 paste helper) and
clicks timed out. Introspection showed the editor is inside `iframe[title="Text editor area"]`
(`.ze_area`). Fix: `frameLocator(...).locator('body')`.

**Zoho — attach is a modal.** "Attachment" opens a modal (Desktop tab) with "Upload files" → chooser
→ "Attach" confirm, not a direct file dialog. Fix: drive the modal.

**Zoho — silent no-op Send after attach.** After the attach modal closed, the Send click landed
mid-render and did nothing (compose stayed open; nothing delivered, but the verifier had passed
early). Fix: retry with `ControlOrMeta+Enter`, then re-click; and verify on real delivery.

**Gmail — false "sent".** The verifier matched the transient "Sending..." toast and reported success
while nothing was delivered. Fix: require the confirmed "Message sent" / "Undo" snackbar.

**Gmail — safety false positive.** `detectSafetySignals` keyword-scanned the inbox and tripped on a
"Security alert" email subject, pausing before compose. Fix: detect walls by URL/CAPTCHA-iframe only.

The throughline: **verify against real delivery, not the UI; use exact accessible names; and read the
screenshot before guessing.**
