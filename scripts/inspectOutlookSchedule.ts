// Reverse-engineer Outlook's "Schedule send" dialog. Uses the saved profile.
try {
  process.loadEnvFile();
} catch {
  /* ignore */
}

import { launchProviderContext } from "../providers/browser";

async function dump(page: import("playwright").Page, label: string) {
  const items = await page
    .$$eval(
      'button, [role="button"], [role="menuitem"], [role="menuitemradio"], input, [role="dialog"] [aria-label]',
      (els) =>
        els
          .map((e) => ({
            tag: e.tagName.toLowerCase(),
            role: e.getAttribute("role"),
            name: (e.getAttribute("aria-label") || (e as HTMLInputElement).value || e.textContent || "")
              .trim()
              .slice(0, 50),
            type: e.getAttribute("type"),
            visible: (e as HTMLElement).offsetParent !== null,
          }))
          .filter((x) => x.visible && x.name)
    )
    .catch(() => []);
  console.log(`\n=== ${label} ===`);
  const seen = new Set<string>();
  for (const it of items) {
    if (!/send|schedule|later|date|time|deliver|^pm$|^am$|cancel|^o?k$/i.test(it.name)) continue;
    const k = JSON.stringify(it);
    if (!seen.has(k)) {
      seen.add(k);
      console.log(k);
    }
  }
}

async function main() {
  const { context, page } = await launchProviderContext("outlook");
  await page.goto("https://outlook.office.com/mail/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /new mail|new message|^new$/i }).first().click();
  await page.getByLabel("To", { exact: true }).first().fill("asraygopa@gmail.com");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Subject", exact: true }).first().fill("schedule probe");
  await page.getByRole("textbox", { name: "Message body" }).first().click();
  await page.keyboard.type("probe");

  // Open the dropdown next to Send ("More send options").
  const more = page.getByRole("button", { name: /more send options|send options/i }).first();
  console.log("more-options visible:", await more.isVisible().catch(() => false));
  await more.click().catch((e) => console.log("more err", e.message));
  await page.waitForTimeout(1200);
  await dump(page, "AFTER MORE-SEND-OPTIONS");
  await page.screenshot({ path: "/tmp/outlook-sched-menu.png" });

  const sched = page
    .getByRole("menuitem", { name: /schedule send|send later/i })
    .first();
  if (await sched.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sched.click();
    await page.waitForTimeout(1500);
    await dump(page, "SCHEDULE DIALOG");
    await page.screenshot({ path: "/tmp/outlook-sched-dialog.png" });

    // Look for a custom option.
    const custom = page.getByText(/custom time|pick|choose/i).first();
    if (await custom.isVisible({ timeout: 1500 }).catch(() => false)) {
      await custom.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: "/tmp/outlook-sched-custom.png" });

      // Dump ALL inputs/comboboxes in the custom dialog, unfiltered.
      const fields = await page.$$eval(
        'input, [role="combobox"], [role="spinbutton"], select, [contenteditable="true"]',
        (els) =>
          els
            .map((e) => ({
              tag: e.tagName.toLowerCase(),
              role: e.getAttribute("role"),
              ariaLabel: e.getAttribute("aria-label"),
              value: (e as HTMLInputElement).value,
              readonly: e.hasAttribute("readonly"),
              visible: (e as HTMLElement).offsetParent !== null,
            }))
            .filter((x) => x.visible)
      );
      console.log("\n=== CUSTOM DIALOG FIELDS ===");
      for (const f of fields) console.log(JSON.stringify(f));

      // Click the time control and see what opens (editable vs preset list).
      const timeField = page
        .getByRole("combobox", { name: /select a time|time/i })
        .or(page.getByLabel(/select a time/i))
        .first();
      if (await timeField.isVisible({ timeout: 1500 }).catch(() => false)) {
        await timeField.click();
        await page.waitForTimeout(800);
        const opts = await page.$$eval('[role="option"], li[role="option"], option', (els) =>
          els
            .map((e) => (e.textContent || "").trim())
            .filter(Boolean)
            .slice(0, 8)
        );
        console.log("\n=== TIME OPTIONS (first 8) ===");
        console.log(JSON.stringify(opts));
        await page.screenshot({ path: "/tmp/outlook-sched-time.png" });
      }
    }
  } else {
    console.log("No 'Schedule send / Send later' menu item found");
  }

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
