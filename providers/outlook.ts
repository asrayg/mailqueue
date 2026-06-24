import type { Page } from "playwright";
import { BaseProvider } from "./base";
import type { ComposeEmailInput, Provider, SendTimingInput } from "./types";

/**
 * Outlook web (outlook.live.com / outlook.office.com) automation. Outlook is
 * generally slower to render, so timeouts are longer than Gmail.
 */
export class OutlookProvider extends BaseProvider {
  readonly provider: Provider = "outlook";
  protected readonly mailboxUrl = "https://outlook.live.com/mail/0/";
  // Outlook mailboxes span outlook.live.com, outlook.office.com, office365.com.
  protected get expectedHostIncludes(): string {
    return "outlook.";
  }

  protected async openMailbox(page: Page): Promise<void> {
    await page.goto(this.mailboxUrl, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: /new mail|new message/i })
      .waitFor({ timeout: 90_000 })
      .catch(() => {});
  }

  protected async uiComposeEmail(page: Page, input: ComposeEmailInput): Promise<void> {
    await page.getByRole("button", { name: /new mail|new message/i }).click();

    const to = page.getByRole("textbox", { name: /^to/i }).first();
    await to.waitFor({ timeout: 30_000 });
    await to.click();
    await to.fill(input.to);
    await page.keyboard.press("Enter");

    const subject = page.getByRole("textbox", { name: /add a subject|subject/i });
    await subject.click();
    await subject.fill(input.subject);

    const body = page.getByRole("textbox", { name: /message body|message/i }).last();
    await body.click();
    await body.fill(input.body);
  }

  protected async uiAttachFiles(page: Page, filePaths: string[]): Promise<void> {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 20_000 }),
      page.getByRole("button", { name: /attach|insert/i }).first().click(),
    ]);
    await fileChooser.setFiles(filePaths);
    await page.waitForTimeout(2000);
    await page
      .getByText(/uploading|attaching/i)
      .waitFor({ state: "hidden", timeout: 180_000 })
      .catch(() => {});
  }

  protected async uiSend(page: Page, _input: SendTimingInput): Promise<void> {
    const sendBtn = page.getByRole("button", { name: /^send$/i }).first();
    await sendBtn.waitFor({ timeout: 20_000 });
    if (await sendBtn.isDisabled()) throw new Error("Send button is disabled");
    await sendBtn.click();
  }

  protected async uiVerifySent(page: Page): Promise<boolean> {
    // After send the compose surface closes; confirm by waiting for it to detach.
    const composeSubject = page.getByRole("textbox", { name: /add a subject|subject/i });
    return composeSubject
      .waitFor({ state: "hidden", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
  }
}
