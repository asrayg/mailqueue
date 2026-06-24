import type { Page } from "playwright";
import { BaseProvider } from "./base";
import type { ComposeEmailInput, Provider, SendTimingInput } from "./types";

/**
 * Zoho Mail automation. Zoho's layout varies by account/theme, so each step
 * uses multiple fallback selectors.
 */
export class ZohoProvider extends BaseProvider {
  readonly provider: Provider = "zoho";
  protected readonly mailboxUrl = "https://mail.zoho.com/zm/";

  protected async openMailbox(page: Page): Promise<void> {
    await page.goto(this.mailboxUrl, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: /new mail|compose/i })
      .first()
      .waitFor({ timeout: 90_000 })
      .catch(() => {});
  }

  private composeButton(page: Page) {
    return page.getByRole("button", { name: /new mail|compose/i }).first();
  }

  protected async uiComposeEmail(page: Page, input: ComposeEmailInput): Promise<void> {
    await this.composeButton(page).click();

    // To field — Zoho labels it "To" but sometimes only a placeholder exists.
    const to = page
      .getByRole("textbox", { name: /^to/i })
      .or(page.locator('input[name="toField"], [aria-label*="To" i]'))
      .first();
    await to.waitFor({ timeout: 30_000 });
    await to.click();
    await to.fill(input.to);
    await page.keyboard.press("Enter");

    const subject = page
      .getByRole("textbox", { name: /subject/i })
      .or(page.locator('input[name="subject"], [aria-label*="Subject" i]'))
      .first();
    await subject.click();
    await subject.fill(input.subject);

    // Body lives in an iframe in some Zoho themes; try the rich-text region first.
    const body = page
      .getByRole("textbox", { name: /message|body/i })
      .or(page.frameLocator("iframe").locator("body"))
      .first();
    await body.click();
    await body.fill(input.body);
  }

  protected async uiAttachFiles(page: Page, filePaths: string[]): Promise<void> {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 20_000 }),
      page
        .getByRole("button", { name: /attach/i })
        .first()
        .click(),
    ]);
    await fileChooser.setFiles(filePaths);
    await page.waitForTimeout(2000);
    await page
      .getByText(/uploading/i)
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
    const toast = page.getByText(/sent|message has been sent/i).first();
    return toast
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
  }
}
