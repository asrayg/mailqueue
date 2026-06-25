import type { Page } from "playwright";
import { BaseProvider } from "./base";
import type { ComposeEmailInput, Provider, SendTimingInput } from "./types";
import { splitRecipients } from "./types";

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
    // NOTE: deliberately NO Escape here. Pressing Escape in Zoho compose pops a
    // modal (zmCompPortalWrapper) that overlays the whole form and blocks Send.
    // Subject uses fill() and the body uses focus(), so no pointer click below
    // the recipient fields is needed.

    // CC — a combobox labeled "CC Recipients" (shown inline in compose).
    const ccList = splitRecipients(input.cc);
    if (ccList.length) {
      const cc = page.getByRole("combobox", { name: /cc recipients/i }).first();
      await cc.click();
      for (const addr of ccList) {
        await cc.fill(addr);
        await page.keyboard.press("Enter");
      }
      // NOTE: do not press Escape here — in Zoho compose that pops a modal that
      // overlays the whole form (incl. Send). Subject uses fill() and the body
      // uses focus(), so neither needs a pointer click the CC popup could block.
    }

    // Subject is an input identified only by its placeholder. Use fill() without
    // a preceding click so a lingering CC suggestion popup can't intercept it.
    const subject = page.getByPlaceholder("Subject", { exact: true }).first();
    await subject.fill(input.subject);

    // The body editor lives inside an iframe ("Text editor area", class ze_area);
    // its document body is contenteditable and pre-filled with the signature.
    // Focus (not click) so a lingering recipient-suggestion / scroll overlay
    // can't intercept the pointer; then select all + type to replace.
    const editorFrame = page.frameLocator(
      'iframe[title="Text editor area"], iframe.ze_area'
    );
    const body = editorFrame.locator("body").first();
    await body.waitFor({ timeout: 30_000 });
    await body.focus();
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

  protected async uiSend(page: Page, input: SendTimingInput): Promise<void> {
    if (input.scheduleAt) {
      await this.uiScheduleSend(page, input.scheduleAt);
      return;
    }
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

  /**
   * Zoho "Send Later": opens a Schedule dialog. Pick "Custom Date and Time",
   * set the date (defaults to today) + 24-hour Hour/Minute spinbuttons, then
   * "Schedule and Send". The mail sends at that time with the app closed.
   * Zoho enforces a minimum lead time (its soonest preset is 10 minutes).
   */
  private async uiScheduleSend(page: Page, when: Date): Promise<void> {
    await page.locator('[data-testid="com_send_later"]').first().click();

    // "Schedule" tab is the default; choose Custom Date and Time.
    await page.getByText(/custom date and time/i).first().click();

    // Set the date if it differs from today's default (MM/DD/YYYY dropdown).
    await this.setZohoDate(page, when).catch(() => {});

    // 24-hour Hour/Minute spinbuttons.
    const hour = page.getByRole("spinbutton", { name: "Hour" }).first();
    const minute = page.getByRole("spinbutton", { name: "Minute" }).first();
    await hour.click();
    await hour.fill(String(when.getHours()).padStart(2, "0"));
    await minute.click();
    await minute.fill(String(when.getMinutes()).padStart(2, "0"));
    await page.keyboard.press("Tab");

    const confirm = page.getByRole("button", { name: /schedule and send/i }).first();
    await confirm.waitFor({ timeout: 10_000 });
    if (await confirm.isDisabled().catch(() => false)) {
      throw new Error("Zoho rejected the scheduled time (below its minimum lead time)");
    }
    await confirm.click();
  }

  /** Set the Zoho "Select Date" field when the target isn't today's default. */
  private async setZohoDate(page: Page, when: Date): Promise<void> {
    const mm = String(when.getMonth() + 1).padStart(2, "0");
    const dd = String(when.getDate()).padStart(2, "0");
    const target = `${mm}/${dd}/${when.getFullYear()}`;
    // The date dropdown shows the current selection; if it already matches
    // today and that's our target, nothing to do.
    const dateField = page
      .getByText(/^\d{2}\/\d{2}\/\d{4}$/)
      .filter({ hasText: target })
      .first();
    if (await dateField.isVisible({ timeout: 1000 }).catch(() => false)) return;
    // Otherwise open the calendar and pick the day number in the current month.
    await page.getByText(/^\d{2}\/\d{2}\/\d{4}$/).first().click().catch(() => {});
    const dayCell = page
      .getByRole("gridcell", { name: String(when.getDate()), exact: true })
      .first();
    await dayCell.click({ timeout: 3000 }).catch(() => {});
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
