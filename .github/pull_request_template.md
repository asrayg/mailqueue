<!-- Thanks for contributing to MailQueue! -->

## What & why

<!-- What does this PR change, and why? Link any related issue (e.g. "Closes #12"). -->

## Type of change

- [ ] Provider selector fix (a provider's web UI changed)
- [ ] Bug fix
- [ ] New feature
- [ ] Docs / chore

## Verification

<!-- How did you verify this works? -->

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] If a provider was touched: ran `npm run mq -- provider test <provider>` and it sent successfully
- [ ] If sending was touched: independently confirmed delivery (not just the provider's "sent" toast)

## Notes

<!-- Screenshots of the new DOM / selectors, edge cases, follow-ups, etc. -->

---

By submitting, I confirm this change keeps MailQueue's safety guarantees intact:
it does **not** bypass CAPTCHA, 2FA, or provider anti-abuse systems, and does not
remove the auto-pause safeguards.
