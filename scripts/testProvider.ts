// Manual provider smoke test: opens the mailbox and sends one email to the
// TEST_RECIPIENT_EMAIL so you can verify login + the compose/send flow.
//
//   npm run test:gmail   (or test:outlook / test:zoho)
//
// On first run a browser window opens — log in manually, then it sends.

try {
  process.loadEnvFile();
} catch {
  /* rely on real environment */
}

import { createProvider, type Provider } from "../providers";

const PROVIDERS: Provider[] = ["gmail", "outlook", "zoho"];

async function main() {
  const arg = process.argv[2] as Provider | undefined;
  if (!arg || !PROVIDERS.includes(arg)) {
    console.error(`Usage: tsx scripts/testProvider.ts <${PROVIDERS.join("|")}>`);
    process.exit(1);
  }

  const to = process.env.TEST_RECIPIENT_EMAIL;
  if (!to) {
    console.error("Set TEST_RECIPIENT_EMAIL in your .env first.");
    process.exit(1);
  }

  // Any extra args after the provider are treated as attachment file paths.
  const attachments = process.argv.slice(3);
  if (attachments.length) console.log(`[${arg}] Attachments: ${attachments.join(", ")}`);

  const provider = createProvider(arg);
  console.log(`[${arg}] Launching browser. Log in if prompted...`);
  await provider.login();

  // First-time login can take a while (password + 2FA). Poll until the mailbox
  // is ready (no logged-out / sign-in signal) before attempting to send.
  const LOGIN_TIMEOUT_MS = 5 * 60_000;
  const startedAt = Date.now();
  let announced = false;
  while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
    const signal = await provider.checkSafety();
    if (!signal || (signal.kind !== "logged_out" && signal.kind !== "captcha")) break;
    if (!announced) {
      console.log(
        `[${arg}] Waiting for you to finish logging in (up to 5 min). ` +
          `Reason: ${signal.kind} — ${signal.detail}`
      );
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Diagnostics: which account are we actually signed into?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = (provider as any).page;
  if (page) {
    try {
      const acct = await page
        .locator('a[aria-label*="@"], [aria-label*="Google Account"]')
        .first()
        .getAttribute("aria-label", { timeout: 3000 });
      console.log(`[${arg}] Signed-in account hint: ${acct ?? "unknown"}`);
    } catch {
      console.log(`[${arg}] Could not read signed-in account.`);
    }
  }

  console.log(`[${arg}] Sending a test email to ${to}...`);
  const result = await provider.send(
    {
      to,
      subject: `MailQueue test ${new Date().toISOString()} (${arg})`,
      body: "This is a MailQueue provider smoke test. If you received this, the automation works.",
    },
    attachments
  );

  // Capture a screenshot of the final state for inspection.
  if (page) {
    try {
      const shot = `/tmp/mailqueue-${arg}-result.png`;
      await page.screenshot({ path: shot, fullPage: false });
      console.log(`[${arg}] Screenshot saved: ${shot}`);
    } catch {
      /* ignore */
    }
  }

  console.log(`[${arg}] Result:`, result);
  await provider.close();
  process.exit(result.success ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
