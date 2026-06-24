import { db } from "./db";
import { createProvider } from "../providers";
import type { Provider } from "../providers";
import { buildVars, render } from "./templates";
import {
  campaignHashes,
  parseAttachmentPaths,
  parseSendDays,
} from "./campaignService";
import {
  dailyLimitReached,
  enoughDelaySinceLastSend,
  hourlyLimitReached,
  MAX_CONSECUTIVE_FAILURES,
} from "./limits";
import { insideSendingWindow } from "./time";

type Campaign = Awaited<ReturnType<typeof db.campaign.findUniqueOrThrow>>;
type Recipient = Awaited<ReturnType<typeof db.recipient.findUniqueOrThrow>>;

/**
 * Should this recipient be skipped due to prior contact (this campaign or
 * globally within the re-contact window)? Returns a reason string or null.
 */
async function skipReason(
  campaign: Campaign,
  recipient: Recipient,
  now: Date
): Promise<string | null> {
  // Already sent in THIS campaign.
  const already = await db.recipient.findFirst({
    where: { campaignId: campaign.id, email: recipient.email, status: "sent" },
  });
  if (already && already.id !== recipient.id) return "Already sent in this campaign";

  // Global contact history — skip if contacted within recontact window.
  if (campaign.recontactAfterDays !== null) {
    const cutoff = new Date(
      now.getTime() - campaign.recontactAfterDays * 24 * 60 * 60 * 1000
    );
    const contacted = await db.globalContactHistory.findFirst({
      where: { email: recipient.email, lastContactedAt: { gte: cutoff } },
    });
    if (contacted) {
      return `Contacted within last ${campaign.recontactAfterDays} days`;
    }
  }
  return null;
}

/** Pause a campaign and record the reason. */
async function pauseCampaign(campaignId: string, reason: string): Promise<void> {
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "paused", lastError: reason },
  });
}

/**
 * Process a single campaign tick: send at most one email if all gates pass.
 * Returns the delay (seconds) the worker should sleep before re-sending for
 * this campaign, or null if nothing was sent.
 */
export async function tickCampaign(
  campaign: Campaign,
  now: Date = new Date()
): Promise<{ sent: boolean; reason?: string }> {
  // Gates ---------------------------------------------------------------
  const window = {
    start: campaign.sendingWindowStart,
    end: campaign.sendingWindowEnd,
    timezone: campaign.timezone,
    days: parseSendDays(campaign.sendDaysJson),
  };
  if (!insideSendingWindow(window, now)) return { sent: false, reason: "outside-window" };
  if (await dailyLimitReached(campaign.id, campaign.maxPerDay, now))
    return { sent: false, reason: "daily-cap" };
  if (await hourlyLimitReached(campaign.id, campaign.maxPerHour, now))
    return { sent: false, reason: "hourly-cap" };
  if (!(await enoughDelaySinceLastSend(campaign.id, campaign.minDelaySeconds, now)))
    return { sent: false, reason: "delay" };

  const recipient = await db.recipient.findFirst({
    where: { campaignId: campaign.id, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (!recipient) {
    await db.campaign.update({
      where: { id: campaign.id },
      data: { status: "completed" },
    });
    return { sent: false, reason: "completed" };
  }

  // Duplicate / contact-history skip ------------------------------------
  const skip = await skipReason(campaign, recipient, now);
  if (skip) {
    await db.recipient.update({
      where: { id: recipient.id },
      data: { status: "skipped", failureReason: skip },
    });
    await db.sendLog.create({
      data: {
        campaignId: campaign.id,
        recipientId: recipient.id,
        provider: campaign.provider,
        subject: campaign.subjectTemplate,
        bodyHash: "",
        attachmentHash: "",
        status: "skipped",
        errorMessage: skip,
      },
    });
    return { sent: false, reason: "skipped" };
  }

  await sendOneEmail(campaign, recipient, now);
  return { sent: true };
}

/**
 * Render + send a single email through the provider adapter, logging the
 * attempt and updating recipient + campaign state. Pauses the campaign on
 * serious errors or after too many consecutive failures.
 */
export async function sendOneEmail(
  campaign: Campaign,
  recipient: Recipient,
  now: Date = new Date(),
  testOverrideTo?: string
): Promise<void> {
  const vars = buildVars(recipient);
  const subject = render(campaign.subjectTemplate, vars).text;
  const body = render(campaign.bodyTemplate, vars).text;
  const attachmentPaths = parseAttachmentPaths(campaign.attachmentPaths);
  const { bodyHash, attachmentHash } = await campaignHashes(campaign.id);
  const to = testOverrideTo ?? recipient.email;

  const provider = createProvider(campaign.provider as Provider);
  let result;
  try {
    await provider.login();
    result = await provider.send({ to, subject, body }, attachmentPaths);
  } catch (err) {
    result = {
      success: false,
      status: "failed" as const,
      error: err instanceof Error ? err.message : String(err),
      serious: true,
    };
  } finally {
    await provider.close();
  }

  // Log the attempt.
  await db.sendLog.create({
    data: {
      campaignId: campaign.id,
      recipientId: recipient.id,
      provider: campaign.provider,
      subject,
      bodyHash,
      attachmentHash,
      status: result.success ? result.status : "failed",
      errorMessage: result.error,
    },
  });

  if (result.success) {
    await db.recipient.update({
      where: { id: recipient.id },
      data: {
        status: result.status === "scheduled" ? "scheduled" : "sent",
        sentAt: now,
        failureReason: null,
      },
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { consecutiveFailures: 0 },
    });
    // Record global contact history (skip for test sends).
    if (!testOverrideTo) {
      await db.globalContactHistory.create({
        data: {
          email: recipient.email,
          lastContactedAt: now,
          campaignId: campaign.id,
          subject,
          provider: campaign.provider,
        },
      });
    }
    return;
  }

  // Failure path --------------------------------------------------------
  await db.recipient.update({
    where: { id: recipient.id },
    data: { status: "failed", failureReason: result.error },
  });
  const updated = await db.campaign.update({
    where: { id: campaign.id },
    data: { consecutiveFailures: { increment: 1 } },
  });

  if (result.serious) {
    await pauseCampaign(campaign.id, `Serious error: ${result.error}`);
  } else if (updated.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    await pauseCampaign(
      campaign.id,
      `Paused after ${updated.consecutiveFailures} consecutive failures`
    );
  }
}
