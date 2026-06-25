import {
  createProvider,
  type ComposeEmailInput,
  type Provider,
  type SendResult,
} from "../providers";

/**
 * Open a provider, wait for the mailbox to be ready (so first-time manual login
 * has time to complete), send one email, and close. Used by `send` and
 * `provider test` — NOT tied to a campaign and never writes contact history.
 */
export async function sendOneOff(
  provider: Provider,
  input: ComposeEmailInput,
  attachments: string[],
  scheduleAt: Date | undefined,
  opts: { loginTimeoutMs?: number; onStatus?: (msg: string) => void } = {}
): Promise<SendResult> {
  const adapter = createProvider(provider);
  const log = opts.onStatus ?? (() => {});
  try {
    await adapter.login();

    // Give a first-time manual login time to finish before sending.
    const timeout = opts.loginTimeoutMs ?? 5 * 60_000;
    const start = Date.now();
    let announced = false;
    while (Date.now() - start < timeout) {
      const signal = await adapter.checkSafety();
      if (!signal || (signal.kind !== "logged_out" && signal.kind !== "captcha")) break;
      if (!announced) {
        log(`Waiting for you to finish logging in to ${provider} (up to 5 min): ${signal.kind}`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    return await adapter.send(input, attachments, scheduleAt ? { scheduleAt } : {});
  } catch (err) {
    return {
      success: false,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      serious: true,
    };
  } finally {
    await adapter.close();
  }
}
