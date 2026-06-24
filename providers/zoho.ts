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
  // Zoho mailboxes span zoho.com / zoho.eu / zoho.in regional hosts.
  protected get expectedHostIncludes(): string {
    return "mail.zoho.";
  }

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

    // To is an input with role=combobox and aria-label "To Recipients".
    const to = page
      .getByRole("combobox", { name: /to recipients/i })
      .or(page.getByRole("combobox", { name: "To Recipients" }))
      .first();
    await to.waitFor({ timeout: 30_000 });
    await to.click();
    await to.fill(input.to);
    await page.waitForTimeout(400);
    await page.keyboard.press("Enter");
    // Dismiss any lingering autocomplete dropdown so it can't overlay the
    // compose toolbar / intercept the Send click.
    await page.keyboard.press("Escape");

    // Subject is an input identified only by its placeholder.
    const subject = page.getByPlaceholder("Subject", { exact: true }).first();
    await subject.click();
    await subject.fill(input.subject);

    // The body editor lives inside an iframe ("Text editor area", class ze_area);
    // its document body is contenteditable and pre-filled with the signature.
    // Click in, select all, and type to replace with our content.
    const editorFrame = page.frameLocator(
      'iframe[title="Text editor area"], iframe.ze_area'
    );
    const body = editorFrame.locator("body").first();
    await body.click({ timeout: 30_000 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(input.body);
  }

  protected async uiAttachFiles(page: Page, filePaths: string[]): Promise<void> {
    // "Attachment" opens a modal (Desktop / My Attachments / Zoho docs / cloud).
    // On the default "Desktop" tab, "Upload files" triggers the file chooser;
    // an "Attach" button then confirms and closes the modal.
    await page.getByRole("button", { name: "Attachment", exact: true }).first().click();

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 20_000 }),
      page.getByRole("button", { name: /upload files/i }).first().click(),
    ]);
    await fileChooser.setFiles(filePaths);

    // Let the upload begin, then confirm with "Attach" if the modal awaits it.
    await page.waitForTimeout(1500);
    const confirm = page.getByRole("button", { name: "Attach", exact: true }).first();
    if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Wait until the confirm button is enabled (upload finished).
      await page
        .waitForFunction(
          (btn) => btn instanceof HTMLButtonElement && !btn.disabled,
          await confirm.elementHandle(),
          { timeout: 180_000 }
        )
        .catch(() => {});
      await confirm.click().catch(() => {});
    }

    // Wait for the upload modal to close.
    await page
      .getByRole("button", { name: /upload files/i })
      .first()
      .waitFor({ state: "hidden", timeout: 180_000 })
      .catch(() => {});
  }

  protected async uiSend(page: Page, _input: SendTimingInput): Promise<void> {
    const sendBtn = page.getByRole("button", { name: "Send", exact: true }).first();
    await sendBtn.waitFor({ timeout: 20_000 });
    if (await sendBtn.isDisabled()) throw new Error("Send button is disabled");
    await sendBtn.click();

    // If the compose surface is still open shortly after (e.g. the click landed
    // mid-render after the attachment modal closed), retry via Zoho's keyboard
    // shortcut (Ctrl/Cmd+Enter).
    await page.waitForTimeout(2500);
    if (await sendBtn.isVisible().catch(() => false)) {
      await page.keyboard.press("ControlOrMeta+Enter");
      await page.waitForTimeout(1500);
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click().catch(() => {});
      }
    }
  }

  protected async uiVerifySent(page: Page): Promise<boolean> {
    // After send Zoho closes the compose tab (Send button detaches) and shows a
    // confirmation toast. Either is sufficient confirmation.
    const sendGone = page
      .getByRole("button", { name: "Send", exact: true })
      .first()
      .waitFor({ state: "hidden", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    const toast = page
      .getByText(/message has been sent|mail sent|sent successfully/i)
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    return Promise.race([sendGone, toast]).then((v) => v || sendGone);
  }
}
