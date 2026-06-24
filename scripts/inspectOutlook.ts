// One-off introspection helper for the Outlook compose DOM. Uses the saved
// browser profile (no login needed). Opens a new message, then dumps the
// accessible names/roles of editable fields + buttons so we can write precise
// selectors. Not part of the product — a debugging aid.

try {
  process.loadEnvFile();
} catch {
  /* ignore */
}

import { launchProviderContext } from "../providers/browser";

async function main() {
  const { context, page } = await launchProviderContext("outlook");
  await page.goto("https://outlook.office.com/mail/", { waitUntil: "domcontentloaded" });
  // Some accounts use outlook.office.com — follow whatever loaded.
  await page.waitForTimeout(8000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "/tmp/outlook-inspect-inbox.png" });

  // Try to open a new message.
  const candidates = [
    'button:has-text("New mail")',
    'button[aria-label="New mail"]',
    '[role="menuitem"][aria-label*="mail" i]',
    'button:has-text("New message")',
  ];
  let opened = false;
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log("Clicking compose candidate:", sel);
      await el.click();
      opened = true;
      break;
    }
  }
  if (!opened) {
    // Fall back to the split "New" button + dropdown.
    const newBtn = page.getByRole("button", { name: /^new$/i }).first();
    if (await newBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log("Clicking split 'New' button");
      await newBtn.click();
      await page.waitForTimeout(800);
      const item = page.getByRole("menuitem", { name: /mail|message|email/i }).first();
      if (await item.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log("Clicking dropdown item:", await item.textContent());
        await item.click();
      }
    }
  }

  await page.waitForTimeout(4000);
  await page.screenshot({ path: "/tmp/outlook-inspect-compose.png" });

  // Dump editable fields.
  const fields = await page.$$eval(
    'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]',
    (els) =>
      els.map((e) => ({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute("role"),
        ariaLabel: e.getAttribute("aria-label"),
        placeholder: e.getAttribute("placeholder"),
        type: e.getAttribute("type"),
        editable: (e as HTMLElement).isContentEditable,
        visible: (e as HTMLElement).offsetParent !== null,
      }))
  );
  console.log("\n=== EDITABLE FIELDS ===");
  for (const f of fields.filter((f) => f.visible)) console.log(JSON.stringify(f));

  // Dump buttons whose name mentions send/attach.
  const buttons = await page.$$eval("button, [role='button']", (els) =>
    els
      .map((e) => ({
        name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40),
        visible: (e as HTMLElement).offsetParent !== null,
      }))
      .filter(
        (b) =>
          b.visible && /send|attach|insert|discard/i.test(b.name)
      )
  );
  console.log("\n=== ACTION BUTTONS ===");
  for (const b of buttons) console.log(JSON.stringify(b));

  console.log("\nScreenshots: /tmp/outlook-inspect-inbox.png, /tmp/outlook-inspect-compose.png");
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
