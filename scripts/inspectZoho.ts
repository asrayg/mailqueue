// One-off introspection helper for the Zoho Mail compose DOM. Uses the saved
// browser profile (no login needed). Opens a new message, then dumps the
// accessible names/roles of editable fields + buttons. Debugging aid only.

try {
  process.loadEnvFile();
} catch {
  /* ignore */
}

import { launchProviderContext } from "../providers/browser";

async function main() {
  const { context, page } = await launchProviderContext("zoho");
  await page.goto("https://mail.zoho.com/zm/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "/tmp/zoho-inspect-inbox.png" });

  // Dump candidate compose buttons first.
  const composeButtons = await page.$$eval("a, button, [role='button']", (els) =>
    els
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40),
        title: e.getAttribute("title"),
        visible: (e as HTMLElement).offsetParent !== null,
      }))
      .filter((b) => b.visible && /new mail|compose|new message/i.test(b.name + " " + (b.title || "")))
  );
  console.log("\n=== COMPOSE BUTTON CANDIDATES ===");
  for (const b of composeButtons) console.log(JSON.stringify(b));

  // Try clicking the first plausible compose entry point.
  const candidates = [
    page.getByRole("button", { name: /new mail/i }),
    page.getByRole("link", { name: /new mail/i }),
    page.getByText(/^new mail$/i),
    page.getByRole("button", { name: /compose/i }),
    page.getByTitle(/new mail|compose/i),
  ];
  for (const c of candidates) {
    const el = c.first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log("\nClicking compose candidate:", await el.textContent().catch(() => "?"));
      await el.click();
      break;
    }
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/zoho-inspect-compose.png" });

  // Dump editable fields across the page and inside any iframes.
  async function dumpFrame(frame: import("playwright").Frame, label: string) {
    const fields = await frame
      .$$eval(
        'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]',
        (els) =>
          els.map((e) => ({
            tag: e.tagName.toLowerCase(),
            role: e.getAttribute("role"),
            ariaLabel: e.getAttribute("aria-label"),
            name: e.getAttribute("name"),
            placeholder: e.getAttribute("placeholder"),
            title: e.getAttribute("title"),
            id: e.id || null,
            editable: (e as HTMLElement).isContentEditable,
            visible: (e as HTMLElement).offsetParent !== null,
          }))
      )
      .catch(() => []);
    const vis = fields.filter((f) => f.visible);
    if (vis.length) {
      console.log(`\n=== EDITABLE FIELDS (${label}) ===`);
      for (const f of vis) console.log(JSON.stringify(f));
    }
  }

  await dumpFrame(page.mainFrame(), "main");
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    await dumpFrame(frame, `iframe ${frame.url().slice(0, 60)}`);
  }

  // List all iframes.
  console.log("\n=== IFRAMES ===");
  const iframes = await page.$$eval("iframe", (els) =>
    els.map((e) => ({
      id: e.id || null,
      name: e.getAttribute("name"),
      title: e.getAttribute("title"),
      cls: (e.getAttribute("class") || "").slice(0, 40),
      visible: (e as HTMLElement).offsetParent !== null,
    }))
  );
  for (const f of iframes) console.log(JSON.stringify(f));

  // Every contenteditable anywhere, with size + identity (the editor will be
  // the large visible one; wms-pasteCapture is the tiny hidden helper).
  console.log("\n=== ALL CONTENTEDITABLE (main) ===");
  const ces = await page.$$eval('[contenteditable="true"]', (els) =>
    els.map((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return {
        tag: e.tagName.toLowerCase(),
        id: e.id || null,
        cls: (e.getAttribute("class") || "").slice(0, 50),
        ariaLabel: e.getAttribute("aria-label"),
        role: e.getAttribute("role"),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    })
  );
  for (const c of ces) console.log(JSON.stringify(c));

  const buttons = await page.$$eval("button, [role='button'], a", (els) =>
    els
      .map((e) => ({
        name: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || "")
          .trim()
          .slice(0, 30),
        visible: (e as HTMLElement).offsetParent !== null,
      }))
      .filter((b) => b.visible && /^send|attach|discard/i.test(b.name))
  );
  console.log("\n=== ACTION BUTTONS ===");
  for (const b of buttons) console.log(JSON.stringify(b));

  // Probe what the "Attachment" button does: file chooser directly, or a menu?
  console.log("\n=== ATTACHMENT PROBE ===");
  const attachBtn = page.getByRole("button", { name: "Attachment", exact: true }).first();
  let chooserFired = false;
  page.once("filechooser", () => {
    chooserFired = true;
    console.log("filechooser fired directly from Attachment button");
  });
  if (await attachBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await attachBtn.click().catch((e) => console.log("attach click err:", e.message));
    await page.waitForTimeout(1500);
    if (!chooserFired) {
      // Dump any menu that appeared.
      const items = await page.$$eval(
        '[role="menuitem"], [role="menu"] a, [role="menu"] button, .zmAttachMenu *',
        (els) =>
          els
            .map((e) => ({
              tag: e.tagName.toLowerCase(),
              name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40),
              visible: (e as HTMLElement).offsetParent !== null,
            }))
            .filter((x) => x.visible && x.name)
      );
      console.log("menu items after clicking Attachment:");
      for (const it of items) console.log(JSON.stringify(it));
    }
  }
  await page.screenshot({ path: "/tmp/zoho-attach-menu.png" });

  console.log("\nScreenshots: /tmp/zoho-inspect-inbox.png, /tmp/zoho-inspect-compose.png");
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
