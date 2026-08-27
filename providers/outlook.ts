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
  private currentComposeBody?: Locator;
  private currentComposeSendButton?: Locator;
  // Default to the work/school host (redirects to outlook.cloud.microsoft).
  // Personal accounts can override via OUTLOOK_MAILBOX_URL=https://outlook.live.com/mail/0/
  protected readonly mailboxUrl =
    process.env.OUTLOOK_MAILBOX_URL ?? "https://outlook.office.com/mail/";
  // Outlook mailboxes span outlook.office.com, outlook.live.com,
  // outlook.cloud.microsoft, outlook.office365.com — all contain "outlook.".
  protected get expectedHostIncludes(): string {
    return "outlook.";
  }

  private async waitForBlockingDialogToClear(page: Page, strict = true): Promise<void> {
    const selector =
      'div[aria-hidden="true"][class*="DialogSurface__backdrop"], div[aria-hidden="true"][class*="fui-DialogSurface__backdrop"]';

    const hasVisibleBackdrop = async (): Promise<boolean> => {
      const backdrops = page.locator(selector);
      for (let i = 0; i < (await backdrops.count()); i += 1) {
        if (await backdrops.nth(i).isVisible({ timeout: 250 }).catch(() => false)) return true;
      }
      return false;
    };

    if (!(await hasVisibleBackdrop())) return;
    // Give Outlook a chance to remove transient overlays naturally. Never
    // press Escape or click a backdrop: either action can open or confirm the
    // destructive "Discard message" workflow for the active draft.
    await page.waitForTimeout(3_000);
    if (!(await hasVisibleBackdrop()) || !strict) return;

    const discardPrompt = page
      .getByRole("dialog")
      .filter({ hasText: /discard message|discard this draft/i })
      .first();
    if (await discardPrompt.isVisible({ timeout: 500 }).catch(() => false)) {
      const cancel = discardPrompt.getByRole("button", { name: /^cancel$/i }).first();
      await cancel.waitFor({ state: "visible", timeout: 10_000 });
      await cancel.click({ timeout: 10_000 });
      await discardPrompt.waitFor({ state: "hidden", timeout: 10_000 });
      return;
    }
    throw new Error("Outlook left a blocking dialog backdrop; campaign paused without interacting with it");
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
    const to = page.getByLabel("To", { exact: true }).last();
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
      const cc = page.getByLabel("Cc", { exact: true }).last();
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
      await page.getByRole("button", { name: "Bcc", exact: true }).last().click();
      const bcc = page.getByLabel("Bcc", { exact: true }).last();
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
      .last();
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

    const body = page.getByRole("textbox", { name: "Message body" }).last();
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
    this.currentComposeBody = body;
    this.currentComposeSendButton = page
      .getByRole("button", { name: "Send", exact: true })
      .last();
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
          .last();
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
          .last();
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
    const timeStr = format12hTime(when);
    const dialog = await this.openCustomScheduleDialog(page);
    let fieldsFilled = false;

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      fieldsFilled = await page.evaluate(
        ({ dateValue, timeValue }) => {
          const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
          const customDialog = dialogs
            .filter((candidate) => /custom date and time/i.test(candidate.innerText || ""))
            .at(-1);
          if (!customDialog) return false;
          const inputs = Array.from(customDialog.querySelectorAll<HTMLInputElement>("input"));
          const dateInput = inputs.find(
            (input) =>
              /select a date/i.test(input.getAttribute("aria-label") || "") ||
              /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(input.value),
          );
          const timeInput = inputs.find(
            (input) =>
              /select a time/i.test(input.getAttribute("aria-label") || "") ||
              /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(input.value),
          );
          if (!dateInput || !timeInput) return false;

          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          if (!valueSetter) return false;
          for (const [input, value] of [
            [timeInput, timeValue],
            [dateInput, dateValue],
          ] as const) {
            valueSetter.call(input, value);
            input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          dateInput.blur();
          timeInput.blur();
          return dateInput.value === dateValue && timeInput.value === timeValue;
        },
        { dateValue: dateStr, timeValue: timeStr },
      );
      if (fieldsFilled) break;
      await page.waitForTimeout(500);
    }

    if (!fieldsFilled) throw new Error("Could not fill Outlook custom scheduling fields");

    // The confirmation label varies between Outlook deployments ("Send",
    // "Schedule", or "Schedule send"), and some builds expose only a submit
    // button without a useful accessible name. Require an explicit click and
    // a confirmed dialog close; never infer scheduling from a disappearing or
    // rerendered dialog.
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    let clicked = false;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      clicked = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
        const customDialog = dialogs.find((candidate) =>
          /custom date and time/i.test(candidate.innerText || candidate.textContent || ""),
        );
        if (!customDialog) return false;
        const send = Array.from(customDialog.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => (button.innerText || button.textContent || "").trim() === "Send",
        );
        if (!send || send.disabled) return false;
        send.click();
        return true;
      });
      if (clicked) break;
      await page.waitForTimeout(500);
    }
    if (!clicked) throw new Error("Could not directly click Outlook custom scheduling Send button");
    await dialog.waitFor({ state: "hidden", timeout: 60_000 });
    await this.waitForBlockingDialogToClear(page, false);
  }

  protected async uiVerifySent(page: Page): Promise<boolean> {
    // Verify the active/latest compose rather than the first Send button on the
    // page; Outlook can retain older draft panes in the DOM. Requiring both the
    // body and Send button to disappear favors a safe false-negative over
    // incorrectly logging an open draft as scheduled.
    const body = this.currentComposeBody ?? page.getByRole("textbox", { name: "Message body" }).last();
    const sendBtn =
      this.currentComposeSendButton ?? page.getByRole("button", { name: "Send", exact: true }).last();
    const [bodyHidden, sendHidden] = await Promise.all([
      body.waitFor({ state: "hidden", timeout: 30_000 }).then(() => true).catch(() => false),
      sendBtn.waitFor({ state: "hidden", timeout: 30_000 }).then(() => true).catch(() => false),
    ]);
    return bodyHidden && sendHidden;
  }
}
