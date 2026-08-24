import type { Locator, Page } from "playwright";
import { BaseProvider } from "./base";
import type { ComposeEmailInput, Provider, SendTimingInput } from "./types";
import { splitRecipients } from "./types";
import { format12hTime } from "../lib/time";

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

  private async waitForBlockingDialogToClear(page: Page): Promise<void> {
    const backdrop = page
      .locator(
        'div[aria-hidden="true"][class*="DialogSurface__backdrop"], div[aria-hidden="true"][class*="fui-DialogSurface__backdrop"]'
      )
      .first();
    if (!(await backdrop.isVisible({ timeout: 500 }).catch(() => false))) return;

    await backdrop.waitFor({ state: "hidden", timeout: 15_000 }).catch(async () => {
      await page.keyboard.press("Escape").catch(() => {});
      await backdrop.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    });
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
    await this.waitForBlockingDialogToClear(page);
    await this.clickCompose(page);
    await this.waitForBlockingDialogToClear(page);

    // To is a contenteditable div with the exact aria-label "To" (exact match
    // avoids matching the "To Do" app icon in the left rail).
    const to = page.getByLabel("To", { exact: true }).first();
    await to.waitFor({ timeout: 30_000 });
    await to.click();
    await to.fill(input.to);
    await page.keyboard.press("Enter");
    // Close the people-picker suggestion popup so it can't overlay the Cc field.
    await page.keyboard.press("Escape");
    await this.waitForBlockingDialogToClear(page);

    // CC — an inline contenteditable div labeled "Cc".
    const ccList = splitRecipients(input.cc);
    if (ccList.length) {
      const cc = page.getByLabel("Cc", { exact: true }).first();
      await cc.click();
      for (const addr of ccList) {
        await cc.fill(addr);
        await page.keyboard.press("Enter");
      }
      await page.keyboard.press("Escape");
    }

    // BCC — hidden until the "Bcc" toggle is clicked; then an inline "Bcc" div.
    const bccList = splitRecipients(input.bcc);
    if (bccList.length) {
      await page.getByRole("button", { name: "Bcc", exact: true }).first().click();
      const bcc = page.getByLabel("Bcc", { exact: true }).first();
      await bcc.click();
      for (const addr of bccList) {
        await bcc.fill(addr);
        await page.keyboard.press("Enter");
      }
      await page.keyboard.press("Escape");
    }

    const subject = page
      .getByRole("textbox", { name: "Subject", exact: true })
      .or(page.getByLabel("Subject", { exact: true }))
      .first();
    await this.waitForBlockingDialogToClear(page);
    await subject.click({ timeout: 10_000 }).catch(async () => {
      await subject.evaluate((el) => (el as HTMLElement).focus());
    });
    await subject.fill(input.subject).catch(async () => {
      await subject.evaluate((el, value) => {
        const target = el as HTMLInputElement;
        target.focus();
        target.value = value;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }, input.subject);
    });

    const body = page.getByRole("textbox", { name: "Message body" }).first();
    await this.waitForBlockingDialogToClear(page);
    await body.click({ timeout: 10_000 }).catch(async () => {
      await body.evaluate((el) => (el as HTMLElement).focus());
    });
    await body.fill(input.body).catch(async () => {
      await body.evaluate((el, value) => {
        const target = el as HTMLElement;
        target.focus();
        target.textContent = value;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }, input.body);
    });
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

  protected async uiSend(page: Page, input: SendTimingInput): Promise<void> {
    if (input.scheduleAt) {
      await this.uiScheduleSend(page, input.scheduleAt);
      return;
    }
    const sendBtn = page.getByRole("button", { name: "Send", exact: true }).first();
    await sendBtn.waitFor({ timeout: 20_000 });
    if (await sendBtn.isDisabled()) throw new Error("Send button is disabled");
    await sendBtn.click();
  }

  /**
   * Outlook "Schedule send": the dropdown next to Send ("More send options") →
   * "Schedule send" → "Custom time" opens a "Set custom date and time" dialog
   * with editable date ("M/D/YYYY") and time ("h:mm AM/PM") comboboxes and a
   * Send button. The mail then sends at that time with the app closed.
   */
  private async openCustomScheduleDialog(page: Page): Promise<Locator> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.waitForBlockingDialogToClear(page);

        const moreSendOptions = page
          .getByRole("button", { name: /more send options/i })
          .first();
        await moreSendOptions.waitFor({ state: "visible", timeout: 30_000 });
        await moreSendOptions.click({ timeout: 30_000 });

        const scheduleSend = page
          .getByRole("menuitem", { name: /schedule send|send later/i })
          .first();
        await scheduleSend.waitFor({ state: "visible", timeout: 30_000 });
        await scheduleSend.click({ timeout: 30_000 });

        const custom = page
          .getByRole("button", { name: /custom time/i })
          .or(page.getByRole("menuitem", { name: /custom time/i }))
          .or(page.getByText(/custom time/i))
          .first();
        await custom.waitFor({ state: "visible", timeout: 30_000 });
        await custom.click({ timeout: 30_000 });

        const dialog = page
          .getByRole("dialog")
          .filter({ hasText: /custom date and time/i })
          .first();
        await dialog.waitFor({ state: "visible", timeout: 30_000 });
        return dialog;
      } catch (error) {
        lastError = error;
        // A menu or partially opened dialog can survive a failed click. Escape
        // back to the compose surface before reopening the scheduling controls.
        await page.keyboard.press("Escape").catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        await this.waitForBlockingDialogToClear(page);
        await page.waitForTimeout(attempt * 1_500);
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Could not open Outlook custom scheduling dialog after 3 attempts: ${detail}`);
  }

  private async uiScheduleSend(page: Page, when: Date): Promise<void> {
    const dateStr = `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()}`;
    let dialog = await this.openCustomScheduleDialog(page);
    let fieldsFilled = false;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        // The date and time fields are unlabeled comboboxes — identify them by
        // the format of their current value. Reacquire them on every attempt
        // because Outlook frequently replaces these nodes while rendering.
        const combos = dialog.getByRole("combobox");
        await combos.nth(1).waitFor({ state: "visible", timeout: 30_000 });
        const count = await combos.count();
        if (count < 2) {
          throw new Error(
            `Outlook custom scheduling dialog exposed ${count} comboboxes; expected at least 2`,
          );
        }
        let dateBox = combos.first();
        let timeBox = combos.last();
        for (let i = 0; i < count; i++) {
          const v = (await combos.nth(i).inputValue().catch(() => "")) || "";
          if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) dateBox = combos.nth(i);
          else if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(v)) timeBox = combos.nth(i);
        }

        await dateBox.click({ timeout: 30_000 });
        await dateBox.fill(dateStr, { timeout: 30_000 });
        await page.keyboard.press("Enter");

        await timeBox.click({ timeout: 30_000 });
        await timeBox.fill(format12hTime(when), { timeout: 30_000 });
        await page.keyboard.press("Enter");
        fieldsFilled = true;
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await page.keyboard.press("Escape").catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(attempt * 1_500);
        dialog = await this.openCustomScheduleDialog(page);
      }
    }

    if (!fieldsFilled) throw new Error("Could not fill Outlook custom scheduling fields");

    // Some Outlook builds commit the schedule when Enter is pressed in the
    // time field. If that happened, let the normal compose-closed verification
    // determine success instead of trying to click a now-missing button.
    if (!(await dialog.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await this.waitForBlockingDialogToClear(page);
      return;
    }

    // The confirmation label varies between Outlook deployments ("Send",
    // "Schedule", or "Schedule send"), and some builds expose only a submit
    // button without a useful accessible name. Keep every fallback scoped to
    // the custom scheduling dialog so the compose Send button cannot match.
    const confirm = dialog
      .getByRole("button", { name: /^(send|schedule|schedule send)$/i })
      .or(dialog.locator('button[type="submit"]'))
      .or(dialog.locator("button").filter({ hasText: /send|schedule/i }))
      .first();

    try {
      const outcome = await Promise.race([
        confirm
          .waitFor({ state: "visible", timeout: 45_000 })
          .then(() => "confirm" as const),
        dialog
          .waitFor({ state: "hidden", timeout: 45_000 })
          .then(() => "closed" as const),
      ]);
      if (outcome === "closed") {
        await this.waitForBlockingDialogToClear(page);
        return;
      }
    } catch (error) {
      // Recheck after the wait: Outlook can detach the whole dialog between
      // Playwright's last poll and timeout reporting.
      if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) {
        await this.waitForBlockingDialogToClear(page);
        return;
      }
      const labels = await dialog
        .locator("button")
        .allTextContents()
        .catch(() => [] as string[]);
      throw new Error(
        `Could not find Outlook schedule confirmation button; dialog buttons were: ${JSON.stringify(labels)}`,
        { cause: error },
      );
    }

    await confirm.click({ timeout: 45_000 });
    await dialog.waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
    await this.waitForBlockingDialogToClear(page);
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
