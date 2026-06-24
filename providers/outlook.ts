import type { Page } from "playwright";
import { BaseProvider } from "./base";
import type { ComposeEmailInput, Provider, SendTimingInput } from "./types";

/**
 * Outlook web (outlook.live.com / outlook.office.com) automation. Outlook is
 * generally slower to render, so timeouts are longer than Gmail.
 */
export class OutlookProvider extends BaseProvider {
  readonly provider: Provider = "outlook";
  // Default to the work/school host (redirects to outlook.cloud.microsoft).
  // Personal accounts can override via OUTLOOK_MAILBOX_URL=https://outlook.live.com/mail/0/
  protected readonly mailboxUrl =
    process.env.OUTLOOK_MAILBOX_URL ?? "https://outlook.office.com/mail/";
  // Outlook mailboxes span outlook.office.com, outlook.live.com,
  // outlook.cloud.microsoft, outlook.office365.com — all contain "outlook.".
  protected get expectedHostIncludes(): string {
    return "outlook.";
  }

  protected async openMailbox(page: Page): Promise<void> {
    await page.goto(this.mailboxUrl, { waitUntil: "domcontentloaded" });
    // Wait for any of the compose-button variants to confirm the mailbox loaded.
    await page
      .getByRole("button", { name: /new mail|new message|^new$/i })
      .first()
      .waitFor({ timeout: 90_000 })
      .catch(() => {});
  }

  /**
   * Open a new message. Outlook's compose entry point varies: classic web shows
   * a "New mail" button; the new Outlook ribbon shows a split "New" button that
   * may open a dropdown where "Mail"/"Email message" must be chosen.
   */
  private async clickCompose(page: Page): Promise<void> {
    const candidates = [
      page.getByRole("button", { name: /new mail/i }),
      page.getByRole("button", { name: /new message/i }),
      page.getByRole("menuitem", { name: /new mail|email message/i }),
      page.getByRole("button", { name: /^new$/i }),
    ];
    let clicked = false;
    for (const c of candidates) {
      const el = c.first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error("Could not find an Outlook compose/New button");

    // If clicking "New" opened a dropdown, pick the mail/email item.
    const mailItem = page
      .getByRole("menuitem", { name: /^(new )?(mail|email)/i })
      .first();
    if (await mailItem.isVisible({ timeout: 1500 }).catch(() => false)) {
      await mailItem.click();
    }
  }

  protected async uiComposeEmail(page: Page, input: ComposeEmailInput): Promise<void> {
    await this.clickCompose(page);

    // To is a contenteditable div with the exact aria-label "To" (exact match
    // avoids matching the "To Do" app icon in the left rail).
    const to = page.getByLabel("To", { exact: true }).first();
    await to.waitFor({ timeout: 30_000 });
    await to.click();
    await to.fill(input.to);
    await page.keyboard.press("Enter");

    const subject = page
      .getByRole("textbox", { name: "Subject", exact: true })
      .or(page.getByLabel("Subject", { exact: true }))
      .first();
    await subject.click();
    await subject.fill(input.subject);

    const body = page.getByRole("textbox", { name: "Message body" }).first();
    await body.click();
    await body.fill(input.body);
  }

  protected async uiAttachFiles(page: Page, filePaths: string[]): Promise<void> {
    // "Attach file" opens a menu; "Browse this computer" triggers the chooser.
    await page.getByRole("button", { name: /attach file/i }).first().click();
    const browse = page
      .getByRole("menuitem", { name: /browse this computer|this computer|upload from/i })
      .first();
    const trigger = (await browse.isVisible({ timeout: 2500 }).catch(() => false))
      ? browse
      : page.getByRole("button", { name: /attach file/i }).first();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 20_000 }),
      trigger.click(),
    ]);
    await fileChooser.setFiles(filePaths);
    await page.waitForTimeout(2000);
    await page
      .getByText(/uploading|attaching/i)
      .waitFor({ state: "hidden", timeout: 180_000 })
      .catch(() => {});
  }

  protected async uiSend(page: Page, _input: SendTimingInput): Promise<void> {
    const sendBtn = page.getByRole("button", { name: "Send", exact: true }).first();
    await sendBtn.waitFor({ timeout: 20_000 });
    if (await sendBtn.isDisabled()) throw new Error("Send button is disabled");
    await sendBtn.click();
  }

  protected async uiVerifySent(page: Page): Promise<boolean> {
    // After a successful send the compose surface closes — the message body
    // textbox and Send button detach. Treat that as confirmation.
    const sendBtn = page.getByRole("button", { name: "Send", exact: true }).first();
    return sendBtn
      .waitFor({ state: "hidden", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
  }
}
