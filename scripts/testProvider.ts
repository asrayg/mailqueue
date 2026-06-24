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

  const provider = createProvider(arg);
  console.log(`[${arg}] Launching browser. Log in if prompted...`);
  await provider.login();

  console.log(`[${arg}] Sending a test email to ${to}...`);
  const result = await provider.send(
    {
      to,
      subject: `MailQueue test (${arg})`,
      body: "This is a MailQueue provider smoke test. If you received this, the automation works.",
    },
    []
  );

  console.log(`[${arg}] Result:`, result);
  await provider.close();
  process.exit(result.success ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
