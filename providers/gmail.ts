import type { Page } from "playwright";
import { BaseProvider } from "./base";
import type { ComposeEmailInput, Provider, SendTimingInput } from "./types";

/**
 * Gmail web automation. Selectors favour ARIA roles + accessible names, which
 * are far more stable than Gmail's churning CSS class names.
 */
export class GmailProvider extends BaseProvider {
  readonly provider: Provider = "gmail";
  protected readonly mailboxUrl = "https://mail.google.com/mail/u/0/#inbox";

  protected async openMailbox(page: Page): Promise<void> {
    await page.goto(this.mailboxUrl, { waitUntil: "domcontentloaded" });
    // Wait for either the Compose button (logged in) or a sign-in page.
    await page
      .getByRole("button", { name: /compose/i })
      .waitFor({ timeout: 60_000 })
      .catch(() => {
        /* may be on a sign-in page; safety check handles that upstream */
      });
  }

  protected async uiComposeEmail(page: Page, input: ComposeEmailInput): Promise<void> {
    await page.getByRole("button", { name: /compose/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 20_000 });

    // Recipient
    const to = dialog.getByRole("combobox", { name: /to recipients|to/i }).first();
    await to.click();
    await to.fill(input.to);
    await page.keyboard.press("Tab");

    // Subject
    const subject = dialog.getByRole("textbox", { name: /subject/i });
    await subject.click();
    await subject.fill(input.subject);

    // Body — the message body is a rich-text region.
    const body = dialog.getByRole("textbox", { name: /message body/i });
    await body.click();
    await body.fill(input.body);
  }

  protected async uiAttachFiles(page: Page, filePaths: string[]): Promise<void> {
    const dialog = page.getByRole("dialog");
    // Gmail's "Attach files" button triggers a hidden <input type=file>.
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15_000 }),
      dialog.getByRole("button", { name: /attach files/i }).click(),
    ]);
    await fileChooser.setFiles(filePaths);
    // Wait for uploads to finish: Gmail shows progress, then the Send button
    // re-enables and attachment chips appear.
    await page.waitForTimeout(1500);
    await dialog
      .getByText(/uploading/i)
      .waitFor({ state: "hidden", timeout: 120_000 })
      .catch(() => {});
  }

  protected async uiSend(page: Page, _input: SendTimingInput): Promise<void> {
    const dialog = page.getByRole("dialog");
    const sendBtn = dialog.getByRole("button", { name: /^send/i }).first();
    await sendBtn.waitFor({ timeout: 15_000 });
    if (await sendBtn.isDisabled()) {
      throw new Error("Send button is disabled");
    }
    await sendBtn.click();
  }

  protected async uiVerifySent(page: Page): Promise<boolean> {
    // Gmail confirms a real send with a snackbar reading "Message sent" that
    // contains an "Undo" / "View message" link. We deliberately do NOT accept
    // the transient "Sending..." toast, which appears before delivery and can
    // produce false positives. The snackbar lives in an aria-live region.
    const confirmed = page
      .getByRole("link", { name: /^undo$/i })
      .or(page.getByText(/^Message sent\b/i))
      .first();
    const ok = await confirmed
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return true;

    // If a recipient/validation problem occurred, Gmail surfaces an error
    // dialog (e.g. "Please specify at least one recipient."). Treat as failure.
    return false;
  }
}
