"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { campaignFormSchema, PROVIDERS, validateDelayRange } from "@/lib/validation";
import { parseRecipientsCsv } from "@/lib/csv";
import { addRecipients, parseAttachmentPaths } from "@/lib/campaignService";
import { sendOneEmail } from "@/lib/scheduler";
import { saveUpload } from "@/lib/storage";
import type { Provider } from "@/lib/validation";

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}
function num(form: FormData, key: string, fallback: number): number {
  const v = parseInt(str(form, key), 10);
  return Number.isFinite(v) ? v : fallback;
}

/** Create a draft campaign from the New Campaign form, upload files + CSV. */
export async function createCampaignAction(form: FormData): Promise<void> {
  const provider = str(form, "provider") as Provider;
  if (!PROVIDERS.includes(provider)) throw new Error("Invalid provider");

  const sendDays = form
    .getAll("sendDays")
    .map((d) => parseInt(d.toString(), 10))
    .filter((n) => Number.isFinite(n));

  const parsed = campaignFormSchema.parse({
    name: str(form, "name"),
    provider,
    subjectTemplate: str(form, "subjectTemplate"),
    bodyTemplate: str(form, "bodyTemplate"),
    cc: str(form, "cc") || undefined,
    bcc: str(form, "bcc") || undefined,
    attachmentPaths: [],
    sendingWindowStart: str(form, "sendingWindowStart") || "09:00",
    sendingWindowEnd: str(form, "sendingWindowEnd") || "16:30",
    timezone: str(form, "timezone") || "America/Chicago",
    sendDays: sendDays.length ? sendDays : [1, 2, 3, 4, 5],
    maxPerHour: num(form, "maxPerHour", 10),
    maxPerDay: num(form, "maxPerDay", 50),
    minDelaySeconds: num(form, "minDelaySeconds", 180),
    maxDelaySeconds: num(form, "maxDelaySeconds", 900),
    recontactAfterDays:
      str(form, "recontactAfterDays") === "never"
        ? null
        : (num(form, "recontactAfterDays", 30) as 30 | 60 | 90),
  });

  const delayErr = validateDelayRange(parsed.minDelaySeconds, parsed.maxDelaySeconds);
  if (delayErr) throw new Error(delayErr);

  const slug = `${Date.now()}-${parsed.name.replace(/[^\w]+/g, "-").slice(0, 40)}`;

  // Save attachments.
  const attachmentPaths: string[] = [];
  for (const f of form.getAll("attachments")) {
    if (f instanceof File && f.size > 0) {
      const buf = Buffer.from(await f.arrayBuffer());
      attachmentPaths.push(saveUpload(slug, f.name, buf));
    }
  }

  const campaign = await db.campaign.create({
    data: {
      name: parsed.name,
      provider: parsed.provider,
      subjectTemplate: parsed.subjectTemplate,
      bodyTemplate: parsed.bodyTemplate,
      cc: parsed.cc ?? null,
      bcc: parsed.bcc ?? null,
      attachmentPaths: JSON.stringify(attachmentPaths),
      sendingWindowStart: parsed.sendingWindowStart,
      sendingWindowEnd: parsed.sendingWindowEnd,
      timezone: parsed.timezone,
      sendDaysJson: JSON.stringify(parsed.sendDays),
      maxPerHour: parsed.maxPerHour,
      maxPerDay: parsed.maxPerDay,
      minDelaySeconds: parsed.minDelaySeconds,
      maxDelaySeconds: parsed.maxDelaySeconds,
      recontactAfterDays: parsed.recontactAfterDays,
      status: "draft",
    },
  });

  // Parse + insert recipients from the uploaded CSV.
  const csvFile = form.get("csv");
  if (csvFile instanceof File && csvFile.size > 0) {
    const text = await csvFile.text();
    const result = parseRecipientsCsv(text);
    await addRecipients(campaign.id, result.valid);
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}/preview`);
}

/** Confirm a campaign and set it running. */
export async function confirmCampaignAction(campaignId: string): Promise<void> {
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "running", lastError: null, consecutiveFailures: 0 },
  });
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}`);
}

export async function pauseCampaignAction(campaignId: string): Promise<void> {
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "paused" },
  });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function resumeCampaignAction(campaignId: string): Promise<void> {
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "running", lastError: null, consecutiveFailures: 0 },
  });
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function cancelCampaignAction(campaignId: string): Promise<void> {
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "cancelled" },
  });
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Reset failed recipients back to pending so the worker retries them. */
export async function retryFailedAction(campaignId: string): Promise<void> {
  await db.recipient.updateMany({
    where: { campaignId, status: "failed" },
    data: { status: "pending", failureReason: null },
  });
  await db.campaign.update({
    where: { id: campaignId },
    data: { consecutiveFailures: 0 },
  });
  revalidatePath(`/campaigns/${campaignId}`);
}

/**
 * Send a single test email to the configured test address (or an override),
 * using the first recipient's variables when available. Runs synchronously so
 * the user can watch the browser. Never writes global contact history.
 */
export async function sendTestEmailAction(
  campaignId: string,
  overrideTo?: string
): Promise<void> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const to = overrideTo?.trim() || process.env.TEST_RECIPIENT_EMAIL;
  if (!to) throw new Error("No test recipient configured (TEST_RECIPIENT_EMAIL).");

  // Use the first recipient for realistic variable substitution, or a stub.
  const sample =
    (await db.recipient.findFirst({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
    })) ??
    ({
      id: "test",
      email: to,
      firstName: "There",
      lastName: null,
      company: "your company",
      metadataJson: null,
    } as Awaited<ReturnType<typeof db.recipient.findUniqueOrThrow>>);

  await sendOneEmail(campaign, sample, new Date(), to);
  revalidatePath(`/campaigns/${campaignId}`);
}

// --- FormData adapters (for use directly as <form action={...}>) ---------

export async function confirmFromForm(form: FormData): Promise<void> {
  await confirmCampaignAction(str(form, "campaignId"));
}
export async function pauseFromForm(form: FormData): Promise<void> {
  await pauseCampaignAction(str(form, "campaignId"));
}
export async function resumeFromForm(form: FormData): Promise<void> {
  await resumeCampaignAction(str(form, "campaignId"));
}
export async function cancelFromForm(form: FormData): Promise<void> {
  await cancelCampaignAction(str(form, "campaignId"));
}
export async function retryFailedFromForm(form: FormData): Promise<void> {
  await retryFailedAction(str(form, "campaignId"));
}
export async function sendTestFromForm(form: FormData): Promise<void> {
  await sendTestEmailAction(str(form, "campaignId"), str(form, "to") || undefined);
}

export { parseAttachmentPaths };
