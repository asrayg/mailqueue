import type { BrowserContext, Page } from "playwright";
import { launchProviderContext, detectSafetySignals } from "./browser";
import type {
  ComposeEmailInput,
  MailProviderAdapter,
  Provider,
  SafetySignal,
  SendResult,
  SendTimingInput,
} from "./types";

/**
 * Shared orchestration for all providers. Subclasses implement the
 * provider-specific UI steps (open mailbox, compose, attach, send, verify).
 */
export abstract class BaseProvider implements MailProviderAdapter {
  abstract readonly provider: Provider;

  protected context?: BrowserContext;
  protected page?: Page;

  /** URL the mailbox lives at, used to detect "are we still logged in". */
  protected abstract readonly mailboxUrl: string;

  // --- Subclass UI steps -------------------------------------------------
  protected abstract openMailbox(page: Page): Promise<void>;
  protected abstract uiComposeEmail(page: Page, input: ComposeEmailInput): Promise<void>;
  protected abstract uiAttachFiles(page: Page, filePaths: string[]): Promise<void>;
  protected abstract uiSend(page: Page, input: SendTimingInput): Promise<void>;
  protected abstract uiVerifySent(page: Page): Promise<boolean>;

  // --- Lifecycle ---------------------------------------------------------
  async login(): Promise<void> {
    const { context, page } = await launchProviderContext(this.provider);
    this.context = context;
    this.page = page;
    await this.openMailbox(page);
  }

  protected ensurePage(): Page {
    if (!this.page) throw new Error("Provider not logged in — call login() first");
    return this.page;
  }

  async checkSafety(): Promise<SafetySignal | null> {
    return detectSafetySignals(this.ensurePage());
  }

  async composeEmail(input: ComposeEmailInput): Promise<void> {
    await this.uiComposeEmail(this.ensurePage(), input);
  }

  async attachFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.uiAttachFiles(this.ensurePage(), filePaths);
  }

  async scheduleOrSend(input: SendTimingInput): Promise<void> {
    await this.uiSend(this.ensurePage(), input);
  }

  async verifySentOrScheduled(): Promise<boolean> {
    return this.uiVerifySent(this.ensurePage());
  }

  /**
   * Full send pipeline with safety gates. Any detected safety signal causes a
   * serious failure so the caller pauses the campaign.
   */
  async send(
    input: ComposeEmailInput,
    filePaths: string[],
    timing: SendTimingInput = {}
  ): Promise<SendResult> {
    try {
      const pre = await this.checkSafety();
      if (pre) return { success: false, status: "failed", error: `${pre.kind}: ${pre.detail}`, serious: true };

      await this.composeEmail(input);
      await this.attachFiles(filePaths);

      const mid = await this.checkSafety();
      if (mid) return { success: false, status: "failed", error: `${mid.kind}: ${mid.detail}`, serious: true };

      await this.scheduleOrSend(timing);

      const post = await this.checkSafety();
      if (post) return { success: false, status: "failed", error: `${post.kind}: ${post.detail}`, serious: true };

      const ok = await this.verifySentOrScheduled();
      if (!ok) {
        return { success: false, status: "failed", error: "Could not verify the email was sent" };
      }
      const status = timing.scheduleAt ? "scheduled" : "sent";
      return { success: true, status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Treat hard navigation/timeout failures as non-serious by default; the
      // caller's consecutive-failure counter will pause after repeated misses.
      return { success: false, status: "failed", error: message };
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }
}
