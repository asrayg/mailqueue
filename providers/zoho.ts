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

  private async firstVisible(locator: ReturnType<Page["locator"]>, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const count = await locator.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i -= 1) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Could not find a visible Zoho compose field");
  }

  private async firstVisibleNamed(locator: ReturnType<Page["locator"]>, name: string, timeout = 30_000) {
    try {
      return await this.firstVisible(locator, timeout);
    } catch {
      throw new Error(`Could not find visible Zoho ${name}`);
    }
  }

  private async dismissBlockingPortal(page: Page): Promise<void> {
    const portal = page.locator("#zmCompPortalWrapper").first();
    if (!(await portal.isVisible({ timeout: 500 }).catch(() => false))) return;

    const close = portal
      .getByRole("button", { name: /close|cancel|ok|dismiss|discard/i })
      .last();
    if (await close.isVisible({ timeout: 1000 }).catch(() => false)) {
      await close.click({ force: true }).catch(() => {});
    } else {
      await page.keyboard.press("Escape").catch(() => {});
    }
    await portal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  protected async uiComposeEmail(page: Page, input: ComposeEmailInput): Promise<void> {
    await this.dismissBlockingPortal(page);
    await this.composeButton(page).click();
    await this.dismissBlockingPortal(page);

    // To is an input with role=combobox and aria-label "To Recipients".
    const to = await this.firstVisible(
      page
        .getByRole("combobox", { name: /to recipients/i })
        .or(page.getByRole("combobox", { name: "To Recipients" })),
    );
    await to.focus();
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
      await cc.focus();
      for (const addr of ccList) {
        await cc.fill(addr);
        await page.keyboard.press("Enter");
      }
      // NOTE: do not press Escape here — in Zoho compose that pops a modal that
      // overlays the whole form (incl. Send). Subject uses fill() and the body
      // uses focus(), so neither needs a pointer click the CC popup could block.
    }

    // BCC — hidden until the "Add Bcc recipients" toggle is clicked.
    const bccList = splitRecipients(input.bcc);
    if (bccList.length) {
      await page.getByRole("button", { name: /add bcc recipients/i }).first().click();
      const bcc = page.getByRole("combobox", { name: /bcc recipients/i }).first();
      await bcc.focus();
      for (const addr of bccList) {
        await bcc.fill(addr);
        await page.keyboard.press("Enter");
      }
      // Same as CC: no Escape (would pop the blocking modal).
    }

    // Subject is an input identified only by its placeholder. Use fill() without
    // a preceding click so a lingering CC suggestion popup can't intercept it.
    const subject = await this.firstVisible(page.getByPlaceholder("Subject", { exact: true }));
    await subject.fill(input.subject);

    // The body editor lives inside an iframe ("Text editor area", class ze_area);
    // its document body is contenteditable and pre-filled with the signature.
    // Focus (not click) so a lingering recipient-suggestion / scroll overlay
    // can't intercept the pointer; then select all + type to replace.
    const editorFrame = page
      .locator('iframe[title="Text editor area"], iframe.ze_area')
      .last()
      .contentFrame();
    const body = editorFrame.locator("body").first();
    await body.waitFor({ timeout: 30_000 });
    await body.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(input.body);

    if (input.inlineImages?.length) {
      await this.uiInsertInlineImages(page, body, input.inlineImages);
    }
  }

  /**
   * Embed images INLINE in the body using Zoho's native "Insert Image → Upload
   * from Disk" dialog. Each image is uploaded by Zoho (not a data: URI), so it
   * renders in every recipient client. Zoho caps inline uploads at 3MB — keep
   * images optimized. Images are stacked at the current cursor (end of body),
   * each on its own line.
   */
  private async uiInsertInlineImages(
    page: Page,
    editorBody: ReturnType<Page["locator"]>,
    imagePaths: string[]
  ): Promise<void> {
    // Wait for the rich-text toolbar to be ready. "More Options" (the overflow
    // chevron) is present on every compose, so use it as the readiness signal.
    await this.firstVisible(page.getByRole("button", { name: "More Options", exact: true }), 30_000);

    // Cursor is at the end of the body after typing. Add a blank line so the
    // images sit below the signature rather than butting up against it.
    await editorBody.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    for (const imagePath of imagePaths) {
      let inserted = false;
      let lastError: unknown;
      for (let attempt = 1; attempt <= 4 && !inserted; attempt += 1) {
        try {
          await this.openZohoInsertImage(page);

          // Confirm the RIGHT dialog opened by waiting for its file input to
          // appear; if the click didn't register, this times out and we retry
          // (rather than pressing Escape, which pops a "save draft?" modal whose
          // backdrop then hides the toolbar for every subsequent attempt).
          const dialog = page.locator('[class*="zmdialog-outer-wrapper"]').last();
          const fileInput = dialog.locator('input[type="file"]').first();
          await fileInput.waitFor({ state: "attached", timeout: 8_000 });

          // "Upload from Disk" is the default tab; set the file on its hidden
          // input directly (avoids a native file-chooser race).
          await fileInput.setInputFiles(imagePath);

          const insertBtn = dialog.getByRole("button", { name: "Insert", exact: true }).first();
          await insertBtn.waitFor({ timeout: 15_000 });
          // Let the upload + preview settle so Insert commits the image.
          await page.waitForTimeout(2_000);
          await insertBtn.click();

          await dialog.waitFor({ state: "hidden", timeout: 20_000 });
          inserted = true;
        } catch (err) {
          lastError = err;
          // Recover WITHOUT Escape: close a half-open Insert Image dialog via
          // its own Cancel/close button so the compose surface stays intact.
          const openDialog = page.locator('[class*="zmdialog-outer-wrapper"]').last();
          const cancel = openDialog.getByRole("button", { name: /^cancel$/i }).first();
          if (await cancel.isVisible({ timeout: 1_500 }).catch(() => false)) {
            await cancel.click().catch(() => {});
          }
          await page.waitForTimeout(1_500);
        }
      }
      if (!inserted) throw lastError ?? new Error("Zoho inline image insert failed");

      // Return focus to the body and drop to a new line for the next image.
      await editorBody.focus();
      await page.keyboard.press("ControlOrMeta+End").catch(() => {});
      await page.keyboard.press("Enter");
    }
  }

  /**
   * Click the toolbar's "Insert Image" control. On the first compose of a
   * session the button sits directly in the toolbar; on every subsequent
   * compose Zoho renders a compact toolbar that tucks the insert-group buttons
   * (Insert Image/Link/Template/…) behind the "More Options" overflow chevron.
   * So: click it directly if visible, otherwise expand "More Options" first.
   */
  private async openZohoInsertImage(page: Page): Promise<void> {
    const insertImage = page.getByRole("button", { name: "Insert Image", exact: true });
    try {
      const direct = await this.firstVisible(insertImage, 2_500);
      await direct.click();
      return;
    } catch {
      // Not directly visible — reveal the overflow row, then click it.
    }
    const more = await this.firstVisible(page.getByRole("button", { name: "More Options", exact: true }), 15_000);
    await more.click();
    await page.waitForTimeout(800);
    const revealed = await this.firstVisible(insertImage, 15_000);
    await revealed.click();
  }

  protected async uiAttachFiles(page: Page, filePaths: string[]): Promise<void> {
    // "Attachment" opens a modal (Desktop / My Attachments / Zoho docs / cloud).
    // On the default "Desktop" tab, "Upload files" triggers the file chooser;
    // an "Attach" button then confirms and closes the modal.
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await page.getByRole("button", { name: "Attachment", exact: true }).first().click();
        const upload = page.getByRole("button", { name: /upload files/i }).first();
        await upload.waitFor({ timeout: 15_000 });

        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 30_000 }),
          upload.click({ force: attempt > 1 }),
        ]);
        await fileChooser.setFiles(filePaths);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    if (lastError) {
      throw lastError;
    }

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

    // Zoho can render the attachment chips before its compose actions are ready
    // again. Give the toolbar a short settling window before Send Later/Send.
    await page.waitForTimeout(5000);
    await this.firstVisible(
      page.locator('[data-testid="com_send_later"]').or(page.getByRole("button", { name: /send later/i })),
      60_000,
    ).catch(() => {});
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
    const customOption = page.getByText(/custom date and time/i).first();
    const sendLaterLocator = page
      .locator('[data-testid="com_send_later"]')
      .or(page.getByRole("button", { name: /send later/i }));

    let opened = false;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await this.dismissBlockingPortal(page);
      const sendButton = page.getByRole("button", { name: "Send", exact: true }).last();
      if (await sendButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendButton.scrollIntoViewIfNeeded().catch(() => {});
        await sendButton.focus().catch(() => {});
      }

      const sendLater = await this.firstVisibleNamed(sendLaterLocator, "Send Later button", 45_000);
      await sendLater.scrollIntoViewIfNeeded().catch(() => {});
      await sendLater.click({ force: true });
      if (await customOption.isVisible({ timeout: 6000 }).catch(() => false)) {
        opened = true;
        break;
      }

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(1500);
    }
    if (!opened) {
      throw new Error("Zoho Send Later menu opened without showing Custom Date and Time");
    }

    // "Schedule" tab is the default; choose Custom Date and Time.
    await customOption.click();

    // Set the date if it differs from today's default (MM/DD/YYYY dropdown).
    await this.setZohoDate(page, when);

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
    await confirm.waitFor({ state: "hidden", timeout: 45_000 });
    await customOption.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
  }

  /** Set the Zoho "Select Date" field when the target isn't today's default. */
  private async setZohoDate(page: Page, when: Date): Promise<void> {
    const mm = String(when.getMonth() + 1).padStart(2, "0");
    const dd = String(when.getDate()).padStart(2, "0");
    const target = `${mm}/${dd}/${when.getFullYear()}`;
    const selectedDate = await this.firstVisibleNamed(
      page.getByText(/^\d{2}\/\d{2}\/\d{4}$/),
      "schedule date field",
    );
    if ((await selectedDate.textContent({ timeout: 1000 }).catch(() => ""))?.trim() === target) {
      return;
    }

    await selectedDate.click();
    await page.waitForTimeout(500);

    const calendar = page
      .locator('[role="dialog"], .zcal, .datePicker, .calendar')
      .filter({ hasText: String(when.getFullYear()) })
      .last();

    const currentMatch = ((await selectedDate.textContent({ timeout: 1000 }).catch(() => "")) ?? "")
      .trim()
      .match(/^(\d{2})\/\d{2}\/(\d{4})$/);
    const currentMonthIndex = currentMatch
      ? (Number(currentMatch[2]) * 12 + Number(currentMatch[1]) - 1)
      : when.getFullYear() * 12 + when.getMonth();
    const targetMonthIndex = when.getFullYear() * 12 + when.getMonth();
    const monthsForward = Math.max(0, Math.min(24, targetMonthIndex - currentMonthIndex));

    for (let i = 0; i < monthsForward; i += 1) {
      const next = calendar
        .getByRole("button", { name: /next|forward|right/i })
        .or(calendar.locator('[aria-label*="Next"], [title*="Next"], .next, .zmdp__next, button').last())
        .last();
      await next.click({ timeout: 5000 });
      await page.waitForTimeout(300);
    }

    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(when);
    const targetAria = `${when.getDate()} ${weekday} ${when.getFullYear()}`;
    if (!(await page.locator(`button:not([disabled])[aria-label="${targetAria}"]`).isVisible({ timeout: 1000 }).catch(() => false))) {
      await selectedDate.click();
      await page.waitForTimeout(500);
    }
    const targetCell = page
      .locator(`button:not([disabled])[aria-label="${targetAria}"]`)
      .or(
        calendar
          .locator("button:not([disabled])")
          .filter({ hasText: new RegExp(`^${when.getDate()}$`) }),
      )
      .first();
    await targetCell.click({ timeout: 5000 });

    await page
      .waitForFunction(
        ([expected, el]) => el instanceof HTMLElement && el.textContent?.trim() === expected,
        [target, await selectedDate.elementHandle()],
        { timeout: 5000 },
      )
      .catch(async () => {
        const actual = (await selectedDate.textContent({ timeout: 1000 }).catch(() => ""))?.trim();
        throw new Error(`Zoho schedule date did not update to ${target}; actual date is ${actual || "unknown"}`);
      });
  }

  protected async uiVerifySent(page: Page): Promise<boolean> {
    if (this.isScheduling) return true;

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
