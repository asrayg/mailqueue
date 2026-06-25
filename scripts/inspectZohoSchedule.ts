// Reverse-engineer Zoho's "Send Later" dialog. Uses the saved profile.
try {
  process.loadEnvFile();
} catch {
  /* ignore */
}

import { launchProviderContext } from "../providers/browser";

async function dumpDialogFields(page: import("playwright").Page, label: string) {
  const fields = await page
    .$$eval(
      'input, [role="combobox"], select, [contenteditable="true"], [role="option"], button',
      (els) =>
        els
          .map((e) => ({
            tag: e.tagName.toLowerCase(),
            role: e.getAttribute("role"),
            name: (e.getAttribute("aria-label") || (e as HTMLInputElement).value || e.textContent || "")
              .trim()
              .slice(0, 40),
            placeholder: e.getAttribute("placeholder"),
            visible: (e as HTMLElement).offsetParent !== null,
          }))
          .filter((x) => x.visible && x.name)
    )
    .catch(() => []);
  console.log(`\n=== ${label} ===`);
  const seen = new Set<string>();
  for (const f of fields) {
    if (!/send later|schedule|date|time|tomorrow|morning|afternoon|custom|am|pm|:\d|send|cancel|done|set/i.test(f.name))
      continue;
    const k = JSON.stringify(f);
    if (!seen.has(k)) {
      seen.add(k);
      console.log(k);
    }
  }
}

async function main() {
  const { context, page } = await launchProviderContext("zoho");
  await page.goto("https://mail.zoho.com/zm/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /new mail|compose/i }).first().click();
  await page.getByRole("combobox", { name: /to recipients/i }).first().fill("asraygopa@gmail.com");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("Subject", { exact: true }).first().fill("schedule probe");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/zoho-before-later.png" });

  // Click "Send Later" via its stable data-testid.
  const later = page.locator('[data-testid="com_send_later"]').first();
  console.log("send-later visible:", await later.isVisible().catch(() => false));
  await later.click({ timeout: 8000 }).catch((e) => console.log("later err", e.message.split("\n")[0]));
  await page.waitForTimeout(1500);
  await dumpDialogFields(page, "SEND LATER DIALOG");
  await page.screenshot({ path: "/tmp/zoho-sched-dialog.png" });

  // Select "Custom Date and Time" and dump the revealed inputs.
  const custom = page.getByText(/custom date and time/i).first();
  if (await custom.isVisible({ timeout: 1500 }).catch(() => false)) {
    await custom.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "/tmp/zoho-sched-custom.png" });
    const fields = await page.$$eval(
      'input, [role="combobox"], select, [contenteditable="true"]',
      (els) =>
        els
          .map((e) => ({
            tag: e.tagName.toLowerCase(),
            role: e.getAttribute("role"),
            ariaLabel: e.getAttribute("aria-label"),
            name: e.getAttribute("name"),
            placeholder: e.getAttribute("placeholder"),
            value: (e as HTMLInputElement).value,
            visible: (e as HTMLElement).offsetParent !== null,
          }))
          .filter((x) => x.visible)
    );
    console.log("\n=== CUSTOM DATE/TIME FIELDS ===");
    for (const f of fields) console.log(JSON.stringify(f));
  } else {
    console.log("Custom Date and Time option not found");
  }

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
