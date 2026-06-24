import type { BrowserContext, Page } from "playwright";

export type Provider = "gmail" | "outlook" | "zoho";

export interface ComposeEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface SendTimingInput {
  // For Mode 1 (app-controlled), this is just an immediate send.
  // Mode 2 (provider-native schedule send) would carry a target Date.
  scheduleAt?: Date;
}

export type SendStatus = "sent" | "scheduled" | "failed" | "skipped";

export interface SendResult {
  success: boolean;
  status: SendStatus;
  error?: string;
  // True when the failure is "serious" and the campaign must pause immediately.
  serious?: boolean;
}

/** A detected unsafe condition that must pause the campaign. */
export interface SafetySignal {
  kind:
    | "captcha"
    | "security_warning"
    | "account_locked"
    | "logged_out"
    | "rate_warning";
  detail: string;
}

export interface MailProviderAdapter {
  readonly provider: Provider;
  /** Open a persistent context and ensure the mailbox is loaded (user logs in manually first time). */
  login(): Promise<void>;
  /** Returns a safety signal if the page shows captcha/security/logout, else null. */
  checkSafety(): Promise<SafetySignal | null>;
  composeEmail(input: ComposeEmailInput): Promise<void>;
  attachFiles(filePaths: string[]): Promise<void>;
  scheduleOrSend(input: SendTimingInput): Promise<void>;
  verifySentOrScheduled(): Promise<boolean>;
  /** High-level helper: run the full compose→attach→send→verify with safety checks. */
  send(
    input: ComposeEmailInput,
    filePaths: string[],
    timing?: SendTimingInput
  ): Promise<SendResult>;
  close(): Promise<void>;
}

export interface ProviderContext {
  context: BrowserContext;
  page: Page;
}
