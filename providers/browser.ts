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
export interface SafetyDetectOptions {
  /**
   * Substring of the host the mailbox is expected to live on (e.g.
   * "mail.google.com"). If the page has navigated to a known auth/challenge
   * host instead, we treat that as logged-out / a security wall.
   */
  expectedHostIncludes: string;
}

// Genuine login / security-challenge hosts the providers redirect to. These are
// full-page takeovers — unlike inbox email content, they are reliable signals.
const AUTH_HOSTS = [
  "accounts.google.com",
  "signin",
  "challenge",
  "login.live.com",
  "login.microsoftonline.com",
  "account.live.com",
  "accounts.zoho.com",
  "accounts.zoho.eu",
];

const CHALLENGE_MARKERS = ["challenge", "/signin/v2", "recaptcha", "deniedsigninrejected"];

/**
 * Detect unsafe conditions WITHOUT keyword-scanning the inbox (email subjects
 * like "Security alert" would otherwise cause false positives). We rely on:
 *   1. the page URL having left the mailbox for an auth/challenge host, and
 *   2. the presence of a real CAPTCHA iframe.
 * We never attempt to solve or bypass any of these.
 */
export async function detectSafetySignals(
  page: Page,
  opts: SafetyDetectOptions
): Promise<SafetySignal | null> {
  const url = page.url().toLowerCase();

  // 1. Real CAPTCHA widgets are iframes from recaptcha/hcaptcha.
  const captchaCount = await page
    .locator(
      'iframe[src*="recaptcha"], iframe[title*="recaptcha" i], iframe[src*="hcaptcha"], iframe[title*="captcha" i]'
    )
    .count()
    .catch(() => 0);
  if (captchaCount > 0) {
    return { kind: "captcha", detail: "CAPTCHA / human-verification widget detected" };
  }

  // Account-picker / explicit sign-in routes can keep the mailbox host (e.g.
  // outlook.live.com/mail/?prompt=select_account), so flag them directly.
  if (
    url.includes("select_account") ||
    url.includes("prompt=select") ||
    url.includes("/login") ||
    url.includes("/logout")
  ) {
    return { kind: "logged_out", detail: `Sign-in/account-picker page: ${url}` };
  }

  // 2. Did we get bounced off the mailbox to an auth/challenge host?
  const onMailbox = url.includes(opts.expectedHostIncludes);
  if (!onMailbox) {
    const onAuthHost = AUTH_HOSTS.some((h) => url.includes(h));
    if (onAuthHost) {
      const isChallenge = CHALLENGE_MARKERS.some((m) => url.includes(m));
      if (isChallenge) {
        return {
          kind: "security_warning",
          detail: `Security challenge page: ${url}`,
        };
      }
      return { kind: "logged_out", detail: `Redirected to sign-in: ${url}` };
    }
    // Navigated somewhere unexpected entirely — be conservative and pause.
    return { kind: "logged_out", detail: `Unexpected location: ${url}` };
  }

  return null;
}
