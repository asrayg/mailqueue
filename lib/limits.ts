import { db } from "./db";

// Conservative defaults for a brand-new sending account.
export const NEW_ACCOUNT_DEFAULTS = {
  maxPerHour: 5,
  maxPerDay: 25,
  minDelaySeconds: 300,
  maxDelaySeconds: 1200,
};

// Standard defaults for a warmed-up account.
export const STANDARD_DEFAULTS = {
  maxPerHour: 10,
  maxPerDay: 50,
  minDelaySeconds: 180,
  maxDelaySeconds: 900,
};

export const MAX_CONSECUTIVE_FAILURES = 3;

/** Count sends in this campaign since `since`. */
async function sentSince(campaignId: string, since: Date): Promise<number> {
  return db.sendLog.count({
    where: {
      campaignId,
      status: "sent",
      createdAt: { gte: since },
    },
  });
}

export async function hourlyLimitReached(
  campaignId: string,
  maxPerHour: number,
  now: Date
): Promise<boolean> {
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  return (await sentSince(campaignId, since)) >= maxPerHour;
}

export async function dailyLimitReached(
  campaignId: string,
  maxPerDay: number,
  now: Date
): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return (await sentSince(campaignId, since)) >= maxPerDay;
}

/** Has enough time elapsed since the last send to respect minDelaySeconds? */
export async function enoughDelaySinceLastSend(
  campaignId: string,
  minDelaySeconds: number,
  now: Date
): Promise<boolean> {
  const last = await db.sendLog.findFirst({
    where: { campaignId, status: "sent" },
    orderBy: { createdAt: "desc" },
  });
  if (!last) return true;
  const elapsedMs = now.getTime() - last.createdAt.getTime();
  return elapsedMs >= minDelaySeconds * 1000;
}
