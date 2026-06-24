import path from "node:path";
import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Provider, SafetySignal } from "./types";

const PROFILES_DIR =
  process.env.BROWSER_PROFILES_DIR ?? path.resolve(process.cwd(), "browser-profiles");

/**
 * Launch (or reuse) a persistent browser context for a provider. Persistent
 * profiles keep the logged-in session so the user only authenticates once.
 *
 * headless defaults to false — email providers frequently flag headless
 * automation. Set PLAYWRIGHT_HEADED=false to override for debugging only.
 */
export async function launchProviderContext(
  provider: Provider
): Promise<{ context: BrowserContext; page: Page }> {
  const profilePath = path.join(PROFILES_DIR, provider);
  mkdirSync(profilePath, { recursive: true });

  const headless = process.env.PLAYWRIGHT_HEADED === "false";

  const context = await chromium.launchPersistentContext(profilePath, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

/**
 * Scan a page's visible text for unsafe conditions. We DO NOT attempt to solve
 * or bypass any of these — detection exists purely to pause the campaign.
 */
export async function detectSafetySignals(
  page: Page
): Promise<SafetySignal | null> {
  let text = "";
  try {
    text = (await page.locator("body").innerText({ timeout: 3000 })).toLowerCase();
  } catch {
    // If we can't even read the body, treat as a logout/navigation issue.
    return { kind: "logged_out", detail: "Could not read page content" };
  }

  // CAPTCHA — never solved, only detected.
  if (
    text.includes("captcha") ||
    text.includes("i'm not a robot") ||
    text.includes("verify you are human") ||
    text.includes("unusual traffic")
  ) {
    return { kind: "captcha", detail: "CAPTCHA / human-verification prompt detected" };
  }

  if (
    text.includes("suspicious activity") ||
    text.includes("unusual sign-in") ||
    text.includes("unusual activity") ||
    text.includes("verify it's you") ||
    text.includes("security alert") ||
    text.includes("your account has been")
  ) {
    return {
      kind: "security_warning",
      detail: "Account security warning detected",
    };
  }

  if (text.includes("account has been locked") || text.includes("account disabled")) {
    return { kind: "account_locked", detail: "Account locked/disabled" };
  }

  if (
    text.includes("sign in") &&
    (text.includes("enter your password") || text.includes("choose an account"))
  ) {
    return { kind: "logged_out", detail: "Appears logged out — sign-in page shown" };
  }

  if (
    text.includes("sending limit") ||
    text.includes("you have reached a limit") ||
    text.includes("messages per day") ||
    text.includes("rate limit")
  ) {
    return { kind: "rate_warning", detail: "Provider rate/sending-limit warning" };
  }

  return null;
}
