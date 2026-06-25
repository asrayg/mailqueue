// Reverse-engineer Gmail's "Schedule send" dialog. Uses the saved profile.
try {
  process.loadEnvFile();
} catch {
  /* ignore */
}

import { launchProviderContext } from "../providers/browser";

async function dumpControls(scope: import("playwright").Locator | import("playwright").Page, label: string) {
  const root = scope as import("playwright").Page;
  const items = await root
    .$$eval(
      'button, [role="button"], [role="menuitem"], input, select, [role="dialog"] *[aria-label]',
      (els) =>
        els
          .map((e) => ({
            tag: e.tagName.toLowerCase(),
            role: e.getAttribute("role"),
            name: (e.getAttribute("aria-label") || (e as HTMLInputElement).value || e.textContent || "")
              .trim()
              .slice(0, 45),
            placeholder: e.getAttribute("placeholder"),
            type: e.getAttribute("type"),
            visible: (e as HTMLElement).offsetParent !== null,
          }))
          .filter((x) => x.visible && x.name)
    )
    .catch(() => []);
  console.log(`\n=== ${label} ===`);
  const seen = new Set<string>();
  for (const it of items) {
    const k = JSON.stringify(it);
    if (!seen.has(k)) {
      seen.add(k);
      console.log(k);
    }
  }
}

async function main() {
  const { context, page } = await launchProviderContext("gmail");
  await page.goto("https://mail.google.com/mail/u/0/#inbox", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /compose/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 20000 });
  await dialog.getByRole("combobox", { name: /to recipients|to/i }).first().fill("asraygopa@gmail.com");
  await page.keyboard.press("Tab");
  await dialog.getByRole("textbox", { name: /subject/i }).fill("schedule probe");
  await dialog.getByRole("textbox", { name: /message body/i }).fill("probe");

  // Open the "More send options" caret next to Send.
  const caret = page.getByRole("button", { name: /more send options/i }).first();
  console.log("caret visible:", await caret.isVisible().catch(() => false));
  await caret.click().catch((e) => console.log("caret err", e.message));
  await page.waitForTimeout(1000);
  await dumpControls(page, "AFTER CARET (menu)");
  await page.screenshot({ path: "/tmp/gmail-sched-menu.png" });

  // Click "Schedule send".
  const sched = page.getByRole("menuitem", { name: /schedule send/i }).first();
  if (await sched.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sched.click();
    await page.waitForTimeout(1500);
    await dumpControls(page, "SCHEDULE DIALOG");
    await page.screenshot({ path: "/tmp/gmail-sched-dialog.png" });

    // Try to reach the custom picker.
    const pick = page.getByText(/pick date & time|pick date and time/i).first();
    if (await pick.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pick.click();
      await page.waitForTimeout(1500);
      await dumpControls(page, "CUSTOM PICKER");
      await page.screenshot({ path: "/tmp/gmail-sched-custom.png" });
    }
  } else {
    console.log("Schedule send menu item not found");
  }

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
