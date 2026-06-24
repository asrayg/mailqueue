// Load .env without a dependency (Node >= 20.12 / 23).
try {
  process.loadEnvFile();
} catch {
  /* no .env file present — rely on real environment */
}

import { db } from "../lib/db";
import { tickCampaign } from "../lib/scheduler";
import { getRandomDelay } from "../lib/time";

/**
 * MailQueue send worker.
 *
 * Runs continuously: every cycle it finds running campaigns and attempts to
 * send a single email per campaign (subject to all caps + the sending window).
 * After a send it waits a randomized human-like delay before the next cycle.
 *
 * Mode 1 (app-controlled scheduling): the worker process must stay running.
 */

const POLL_INTERVAL_MS = 60_000;
let stopping = false;

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

async function getRunningCampaigns() {
  return db.campaign.findMany({ where: { status: "running" } });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function cycle() {
  const campaigns = await getRunningCampaigns();
  if (campaigns.length === 0) return;

  for (const campaign of campaigns) {
    if (stopping) return;
    try {
      const result = await tickCampaign(campaign);
      if (result.sent) {
        const delay = getRandomDelay(
          campaign.minDelaySeconds,
          campaign.maxDelaySeconds
        );
        log(`Sent for "${campaign.name}". Sleeping ${delay}s (randomized delay).`);
        await sleep(delay * 1000);
      } else if (result.reason && result.reason !== "delay") {
        log(`"${campaign.name}": no send (${result.reason}).`);
      }
    } catch (err) {
      log(`Error ticking "${campaign.name}": ${(err as Error).message}`);
    }
  }
}

async function main() {
  log("MailQueue worker started. Polling every 60s for running campaigns.");
  while (!stopping) {
    try {
      await cycle();
    } catch (err) {
      log(`Cycle error: ${(err as Error).message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  log("Worker stopped.");
  await db.$disconnect();
}

process.on("SIGINT", () => {
  log("SIGINT — shutting down gracefully...");
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
