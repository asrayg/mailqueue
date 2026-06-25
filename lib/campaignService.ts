import { db } from "./db";
import { buildVars, render } from "./templates";
import { hashFiles, hashString } from "./hashing";
import type { ParsedRecipient } from "./csv";

/** Parse the JSON int[] of allowed send days. */
export function parseSendDays(json: string): number[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [1, 2, 3, 4, 5];
  } catch {
    return [1, 2, 3, 4, 5];
  }
}

export function parseAttachmentPaths(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Insert recipients for a campaign, skipping any email already present. */
export async function addRecipients(
  campaignId: string,
  recipients: ParsedRecipient[]
): Promise<number> {
  const existing = new Set(
    (
      await db.recipient.findMany({
        where: { campaignId },
        select: { email: true },
      })
    ).map((r) => r.email)
  );

  const toCreate = recipients
    .filter((r) => !existing.has(r.email))
    .map((r) => ({
      campaignId,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
      cc: r.cc,
      bcc: r.bcc,
      metadataJson: JSON.stringify(r.metadata ?? {}),
    }));

  if (toCreate.length === 0) return 0;
  await db.recipient.createMany({ data: toCreate });
  return toCreate.length;
}

export interface EmailPreview {
  email: string;
  subject: string;
  body: string;
  missingVars: string[];
}

/** Render the first N recipient emails for the preview page. */
export async function previewEmails(
  campaignId: string,
  limit = 5
): Promise<EmailPreview[]> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const recipients = await db.recipient.findMany({
    where: { campaignId },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  return recipients.map((r) => {
    const vars = buildVars(r);
    const subject = render(campaign.subjectTemplate, vars);
    const body = render(campaign.bodyTemplate, vars);
    return {
      email: r.email,
      subject: subject.text,
      body: body.text,
      missingVars: [...new Set([...subject.missingVars, ...body.missingVars])],
    };
  });
}

export interface CampaignStats {
  pending: number;
  scheduled: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const grouped = await db.recipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const stats: CampaignStats = {
    pending: 0,
    scheduled: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
  for (const g of grouped) {
    const n = g._count._all;
    stats.total += n;
    if (g.status in stats) {
      (stats as unknown as Record<string, number>)[g.status] += n;
    }
  }
  return stats;
}

/** Compute body/attachment hashes for a campaign (used in send logs). */
export async function campaignHashes(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const attachmentPaths = parseAttachmentPaths(campaign.attachmentPaths);
  return {
    bodyHash: hashString(campaign.bodyTemplate),
    attachmentHash: safeHashFiles(attachmentPaths),
  };
}

// Hashing missing files would throw — guard it for the preview/log path.
function safeHashFiles(paths: string[]): string {
  try {
    return hashFiles(paths);
  } catch {
    return hashString("missing-attachments");
  }
}
