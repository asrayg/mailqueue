#!/usr/bin/env -S npx tsx
import { loadEnv } from "./util";
loadEnv();

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { db } from "../lib/db";
import { campaignFormSchema } from "../lib/validation";
import { parseRecipientsCsv } from "../lib/csv";
import {
  addRecipients,
  previewEmails,
  getCampaignStats,
  parseAttachmentPaths,
  parseSendDays,
} from "../lib/campaignService";
import { checkFiles } from "../lib/hashing";
import { estimateCompletion, formatLocal, getRandomDelay } from "../lib/time";
import { tickCampaign, sendOneEmail } from "../lib/scheduler";
import { sendOneOff } from "./providerSend";
import {
  emit,
  fail,
  isJson,
  setJsonMode,
  parseProvider,
  resolveAttachments,
  readBody,
  parseDays,
  parseWindow,
  parseDelay,
  parseRecontact,
  parseScheduleAt,
} from "./util";

const program = new Command();

program
  .name("mailqueue")
  .description("Controlled, scheduled, multi-provider email outreach (CLI).")
  .version("0.2.0")
  .option("--json", "machine-readable JSON output (use this when scripting)")
  .hook("preAction", (thisCmd) => {
    setJsonMode(Boolean(thisCmd.opts().json));
  });

async function shutdown(code = 0): Promise<never> {
  await db.$disconnect().catch(() => {});
  process.exit(code);
}

// ---------------------------------------------------------------------------
// campaign
// ---------------------------------------------------------------------------
const campaign = program.command("campaign").description("Manage outreach campaigns");

campaign
  .command("create")
  .description("Create a draft campaign (then preview, test, and start it)")
  .option("--config <file>", "JSON config file; flags override its values")
  .option("--name <name>")
  .option("--provider <provider>", "gmail | outlook | zoho")
  .option("--subject <subject>")
  .option("--body <text>")
  .option("--body-file <file>")
  .option("--cc <emails>", "fixed CC recipient(s), comma-separated, applied to every send")
  .option("--bcc <emails>", "fixed BCC recipient(s), comma-separated, applied to every send")
  .option("--csv <file>", "recipients CSV (email col required; optional cc/bcc cols are per-recipient)")
  .option("--attach <file...>", "attachment file path(s)")
  .option("--window <HH:MM-HH:MM>", "sending window (local to --tz)")
  .option("--tz <timezone>", "IANA timezone", "America/Chicago")
  .option("--days <spec>", "weekdays | all | 1,2,3,4,5")
  .option("--max-per-hour <n>", "hourly cap", (v) => parseInt(v, 10))
  .option("--max-per-day <n>", "daily cap", (v) => parseInt(v, 10))
  .option("--delay <MIN-MAX>", "delay range in seconds, e.g. 180-900")
  .option("--recontact <spec>", "30 | 60 | 90 | never", "30")
  .action(async (opts) => {
    const cfg = opts.config ? JSON.parse(readFileSync(path.resolve(opts.config), "utf8")) : {};
    const provider = parseProvider(opts.provider ?? cfg.provider ?? "");
    const window = parseWindow(opts.window ?? cfg.window);
    const delay = parseDelay(opts.delay ?? cfg.delay);
    const attachInputs: string[] = opts.attach ?? cfg.attachments ?? [];
    const attachmentPaths = resolveAttachments(attachInputs);

    const values = campaignFormSchema.parse({
      name: opts.name ?? cfg.name,
      provider,
      subjectTemplate: opts.subject ?? cfg.subject,
      bodyTemplate: opts.body || opts.bodyFile ? readBody(opts) : cfg.body,
      cc: opts.cc ?? cfg.cc,
      bcc: opts.bcc ?? cfg.bcc,
      attachmentPaths,
      sendingWindowStart: window.start,
      sendingWindowEnd: window.end,
      timezone: opts.tz ?? cfg.timezone ?? "America/Chicago",
      sendDays: parseDays(opts.days ?? cfg.days),
      maxPerHour: opts.maxPerHour ?? cfg.maxPerHour ?? 10,
      maxPerDay: opts.maxPerDay ?? cfg.maxPerDay ?? 50,
      minDelaySeconds: delay.min,
      maxDelaySeconds: delay.max,
      recontactAfterDays: parseRecontact(opts.recontact ?? cfg.recontact),
    });
    if (values.maxDelaySeconds < values.minDelaySeconds)
      fail("max delay must be >= min delay");

    const created = await db.campaign.create({
      data: {
        name: values.name,
        provider: values.provider,
        subjectTemplate: values.subjectTemplate,
        bodyTemplate: values.bodyTemplate,
        cc: values.cc ?? null,
        bcc: values.bcc ?? null,
        attachmentPaths: JSON.stringify(attachmentPaths),
        sendingWindowStart: values.sendingWindowStart,
        sendingWindowEnd: values.sendingWindowEnd,
        timezone: values.timezone,
        sendDaysJson: JSON.stringify(values.sendDays),
        maxPerHour: values.maxPerHour,
        maxPerDay: values.maxPerDay,
        minDelaySeconds: values.minDelaySeconds,
        maxDelaySeconds: values.maxDelaySeconds,
        recontactAfterDays: values.recontactAfterDays,
        status: "draft",
      },
    });

    let imported = 0;
    let csvStats: ReturnType<typeof parseRecipientsCsv> | null = null;
    const csvPath = opts.csv ?? cfg.csv;
    if (csvPath) {
      const abs = path.resolve(csvPath);
      if (!existsSync(abs)) fail(`CSV not found: ${csvPath}`);
      csvStats = parseRecipientsCsv(readFileSync(abs, "utf8"));
      imported = await addRecipients(created.id, csvStats.valid);
    }

    emit(
      {
        ok: true,
        id: created.id,
        name: created.name,
        provider: created.provider,
        status: created.status,
        recipientsImported: imported,
        csv: csvStats
          ? {
              valid: csvStats.valid.length,
              duplicateRows: csvStats.duplicateRows,
              invalidRows: csvStats.invalidRows,
            }
          : null,
        nextStep: `mailqueue campaign preview ${created.id}`,
      },
      (d) => {
        console.log(`Created campaign ${d.id} ("${d.name}", ${d.provider}, ${d.status}).`);
        console.log(`Imported ${d.recipientsImported} recipients.`);
        if (d.csv)
          console.log(`CSV: ${d.csv.valid} valid, ${d.csv.duplicateRows} dupes, ${d.csv.invalidRows} invalid.`);
        console.log(`Next: ${d.nextStep}`);
      }
    );
    await shutdown();
  });

campaign
  .command("list")
  .description("List all campaigns with per-status counts")
  .action(async () => {
    const rows = await db.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { recipients: { select: { status: true } } },
    });
    const data = rows.map((c) => {
      const counts: Record<string, number> = {};
      for (const r of c.recipients) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return {
        id: c.id,
        name: c.name,
        provider: c.provider,
        status: c.status,
        recipients: c.recipients.length,
        sent: counts.sent ?? 0,
        failed: counts.failed ?? 0,
        skipped: counts.skipped ?? 0,
        pending: counts.pending ?? 0,
        createdAt: c.createdAt.toISOString(),
      };
    });
    emit({ ok: true, campaigns: data }, (d) => {
      if (d.campaigns.length === 0) return console.log("No campaigns.");
      for (const c of d.campaigns)
        console.log(
          `${c.id}  ${c.status.padEnd(9)} ${c.provider.padEnd(7)} sent:${c.sent} fail:${c.failed} skip:${c.skipped} pend:${c.pending}  ${c.name}`
        );
    });
    await shutdown();
  });

async function loadCampaign(id: string) {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) fail(`Campaign not found: ${id}`, 4);
  return c!;
}

campaign
  .command("show <id>")
  .description("Show a campaign's config, stats, and last error")
  .action(async (id) => {
    const c = await loadCampaign(id);
    const stats = await getCampaignStats(id);
    const attachmentPaths = parseAttachmentPaths(c.attachmentPaths);
    emit(
      {
        ok: true,
        id: c.id,
        name: c.name,
        provider: c.provider,
        status: c.status,
        subject: c.subjectTemplate,
        cc: c.cc,
        bcc: c.bcc,
        window: `${c.sendingWindowStart}-${c.sendingWindowEnd} ${c.timezone}`,
        sendDays: parseSendDays(c.sendDaysJson),
        caps: { maxPerHour: c.maxPerHour, maxPerDay: c.maxPerDay },
        delaySeconds: { min: c.minDelaySeconds, max: c.maxDelaySeconds },
        recontactAfterDays: c.recontactAfterDays,
        attachments: attachmentPaths,
        consecutiveFailures: c.consecutiveFailures,
        lastError: c.lastError,
        stats,
      },
      (d) => {
        console.log(`${d.name} [${d.status}] (${d.provider})`);
        console.log(`Subject: ${d.subject}`);
        console.log(`Window: ${d.window}, days ${d.sendDays.join(",")}`);
        console.log(`Caps: ${d.caps.maxPerHour}/hr ${d.caps.maxPerDay}/day, delay ${d.delaySeconds.min}-${d.delaySeconds.max}s`);
        console.log(`Stats: ${JSON.stringify(d.stats)}`);
        if (d.lastError) console.log(`Last error: ${d.lastError}`);
      }
    );
    await shutdown();
  });

campaign
  .command("preview <id>")
  .description("Render the first N emails + duplicate/invalid/attachment checks")
  .option("--limit <n>", "how many to render", (v) => parseInt(v, 10), 5)
  .action(async (id, opts) => {
    const c = await loadCampaign(id);
    const total = await db.recipient.count({ where: { campaignId: id } });
    const previews = await previewEmails(id, opts.limit);
    const attachmentPaths = parseAttachmentPaths(c.attachmentPaths);
    const fileChecks = checkFiles(attachmentPaths);
    const badFiles = fileChecks.filter((f) => !f.exists || f.tooLarge);
    const missingVars = [...new Set(previews.flatMap((p) => p.missingVars))];
    const finish = estimateCompletion(total, c.maxPerDay, new Date());
    const blockers: string[] = [];
    if (total === 0) blockers.push("no recipients");
    if (badFiles.length) blockers.push(`${badFiles.length} missing/oversized attachment(s)`);

    emit(
      {
        ok: true,
        id,
        recipients: total,
        attachments: fileChecks.map((f) => ({
          path: f.path,
          exists: f.exists,
          tooLarge: f.tooLarge,
        })),
        missingVars,
        estimatedFinish: formatLocal(finish, c.timezone),
        previews,
        startBlockers: blockers,
        canStart: blockers.length === 0,
      },
      (d) => {
        console.log(`Recipients: ${d.recipients}  |  est. finish ${d.estimatedFinish}`);
        if (d.missingVars.length) console.log(`Missing vars: ${d.missingVars.join(", ")}`);
        for (const p of d.previews) {
          console.log(`\n--- ${p.email} ---\nSubject: ${p.subject}\n${p.body}`);
        }
        console.log(d.canStart ? "\nReady to start." : `\nBLOCKED: ${d.startBlockers.join("; ")}`);
      }
    );
    await shutdown();
  });

campaign
  .command("import <id>")
  .description("Add recipients from a CSV to an existing campaign")
  .requiredOption("--csv <file>")
  .action(async (id, opts) => {
    await loadCampaign(id);
    const abs = path.resolve(opts.csv);
    if (!existsSync(abs)) fail(`CSV not found: ${opts.csv}`);
    const stats = parseRecipientsCsv(readFileSync(abs, "utf8"));
    const imported = await addRecipients(id, stats.valid);
    emit(
      { ok: true, imported, duplicateRows: stats.duplicateRows, invalidRows: stats.invalidRows },
      (d) => console.log(`Imported ${d.imported} (dupes:${d.duplicateRows} invalid:${d.invalidRows}).`)
    );
    await shutdown();
  });

campaign
  .command("recipients <id>")
  .description("List recipients (optionally filtered by status)")
  .option("--status <status>", "pending|scheduled|sent|failed|skipped")
  .option("--limit <n>", "max rows", (v) => parseInt(v, 10), 200)
  .action(async (id, opts) => {
    await loadCampaign(id);
    const rows = await db.recipient.findMany({
      where: { campaignId: id, ...(opts.status ? { status: opts.status } : {}) },
      orderBy: { createdAt: "asc" },
      take: opts.limit,
    });
    emit(
      {
        ok: true,
        count: rows.length,
        recipients: rows.map((r) => ({
          email: r.email,
          status: r.status,
          sentAt: r.sentAt?.toISOString() ?? null,
          failureReason: r.failureReason,
        })),
      },
      (d) => {
        for (const r of d.recipients)
          console.log(`${r.status.padEnd(9)} ${r.email}${r.failureReason ? "  — " + r.failureReason : ""}`);
        console.log(`(${d.count} shown)`);
      }
    );
    await shutdown();
  });

campaign
  .command("test <id>")
  .description("Send ONE test email (to --to or TEST_RECIPIENT_EMAIL). Opens a browser.")
  .option("--to <email>", "override test recipient")
  .action(async (id, opts) => {
    const c = await loadCampaign(id);
    const to = opts.to?.trim() || process.env.TEST_RECIPIENT_EMAIL;
    if (!to) fail("No test recipient (set TEST_RECIPIENT_EMAIL or pass --to)");
    const sample =
      (await db.recipient.findFirst({ where: { campaignId: id }, orderBy: { createdAt: "asc" } })) ??
      ({ id: "test", email: to, firstName: "There", lastName: null, company: "your company", metadataJson: null } as any);
    if (!isJson()) console.error("Opening browser to send test email...");
    await sendOneEmail(c, sample, new Date(), to);
    emit({ ok: true, testSentTo: to }, (d) => console.log(`Test email sent to ${d.testSentTo}.`));
    await shutdown();
  });

campaign
  .command("start <id>")
  .description("Confirm and start a campaign (refuses if there are blockers)")
  .action(async (id) => {
    const c = await loadCampaign(id);
    const total = await db.recipient.count({ where: { campaignId: id } });
    const badFiles = checkFiles(parseAttachmentPaths(c.attachmentPaths)).filter((f) => !f.exists || f.tooLarge);
    if (total === 0) fail("Refusing to start: no recipients. Import a CSV first.", 5);
    if (badFiles.length) fail(`Refusing to start: ${badFiles.length} missing/oversized attachment(s).`, 5);
    await db.campaign.update({
      where: { id },
      data: { status: "running", lastError: null, consecutiveFailures: 0 },
    });
    emit(
      { ok: true, id, status: "running", recipients: total, note: "Run `mailqueue worker` to dispatch sends." },
      (d) => console.log(`Campaign ${d.id} is running (${d.recipients} recipients). Start the worker to send.`)
    );
    await shutdown();
  });

for (const [name, status, verb] of [
  ["pause", "paused", "Paused"],
  ["resume", "running", "Resumed"],
  ["cancel", "cancelled", "Cancelled"],
] as const) {
  campaign
    .command(`${name} <id>`)
    .description(`${verb} a campaign`)
    .action(async (id) => {
      await loadCampaign(id);
      await db.campaign.update({
        where: { id },
        data:
          status === "running"
            ? { status, lastError: null, consecutiveFailures: 0 }
            : { status },
      });
      emit({ ok: true, id, status }, (d) => console.log(`${verb} ${d.id}.`));
      await shutdown();
    });
}

campaign
  .command("retry <id>")
  .description("Reset failed recipients to pending so the worker retries them")
  .action(async (id) => {
    await loadCampaign(id);
    const res = await db.recipient.updateMany({
      where: { campaignId: id, status: "failed" },
      data: { status: "pending", failureReason: null },
    });
    await db.campaign.update({ where: { id }, data: { consecutiveFailures: 0 } });
    emit({ ok: true, requeued: res.count }, (d) => console.log(`Requeued ${d.requeued} failed recipients.`));
    await shutdown();
  });

campaign
  .command("logs <id>")
  .description("Export send logs (CSV to --out, or JSON to stdout)")
  .option("--out <file>", "write CSV to this path")
  .action(async (id, opts) => {
    await loadCampaign(id);
    const logs = await db.sendLog.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "asc" },
      include: { recipient: { select: { email: true } } },
    });
    if (opts.out) {
      const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
      const header = ["createdAt", "email", "provider", "status", "subject", "errorMessage"];
      const lines = logs.map((l) =>
        [l.createdAt.toISOString(), l.recipient?.email ?? "", l.provider, l.status, l.subject, l.errorMessage ?? ""]
          .map(esc)
          .join(",")
      );
      writeFileSync(path.resolve(opts.out), [header.join(","), ...lines].join("\n"));
      emit({ ok: true, written: opts.out, rows: logs.length }, (d) => console.log(`Wrote ${d.rows} rows to ${d.written}.`));
    } else {
      emit(
        {
          ok: true,
          logs: logs.map((l) => ({
            createdAt: l.createdAt.toISOString(),
            email: l.recipient?.email ?? null,
            status: l.status,
            subject: l.subject,
            error: l.errorMessage,
          })),
        },
        (d) => {
          for (const l of d.logs) console.log(`${l.createdAt} ${l.status.padEnd(9)} ${l.email} ${l.error ?? ""}`);
        }
      );
    }
    await shutdown();
  });

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------
const provider = program.command("provider").description("Provider login + smoke tests");

provider
  .command("login <provider>")
  .description("Open the provider in a browser so you can log in once (session is saved)")
  .action(async (p) => {
    const prov = parseProvider(p);
    const { createProvider } = await import("../providers");
    const adapter = createProvider(prov);
    if (!isJson()) console.error(`Opening ${prov}. Log in, then close this when the mailbox has loaded.`);
    await adapter.login();
    // Hold the browser open a bit so the user can authenticate; session persists.
    await new Promise((r) => setTimeout(r, 120_000));
    await adapter.close();
    emit({ ok: true, provider: prov }, (d) => console.log(`Session saved for ${d.provider}.`));
    await shutdown();
  });

provider
  .command("test <provider>")
  .description("Send a smoke-test email to verify a provider end to end")
  .option("--to <email>", "recipient (default TEST_RECIPIENT_EMAIL)")
  .option("--cc <emails>", "CC recipient(s), comma-separated")
  .option("--bcc <emails>", "BCC recipient(s), comma-separated")
  .option("--attach <file...>", "attachment file path(s)")
  .option("--in <spec>", "schedule N minutes out (Mode 2), e.g. --in 10")
  .action(async (p, opts) => {
    const prov = parseProvider(p);
    const to = opts.to?.trim() || process.env.TEST_RECIPIENT_EMAIL;
    if (!to) fail("No recipient (set TEST_RECIPIENT_EMAIL or pass --to)");
    const attachments = resolveAttachments(opts.attach ?? []);
    const scheduleAt = parseScheduleAt(opts.in);
    const result = await sendOneOff(
      prov,
      {
        to,
        cc: opts.cc,
        bcc: opts.bcc,
        subject: `MailQueue test ${new Date().toISOString()} (${prov})`,
        body: "MailQueue provider smoke test.",
      },
      attachments,
      scheduleAt,
      { onStatus: (m) => !isJson() && console.error(m) }
    );
    emit({ ok: result.success, provider: prov, to, ...result }, (d) =>
      console.log(`${d.provider} -> ${d.to}: ${d.status}${d.error ? " — " + d.error : ""}`)
    );
    await shutdown(result.success ? 0 : 2);
  });

// ---------------------------------------------------------------------------
// send (one-off, no campaign)
// ---------------------------------------------------------------------------
program
  .command("send")
  .description("Send a single email immediately or scheduled (no campaign, no logging)")
  .requiredOption("--provider <provider>", "gmail | outlook | zoho")
  .requiredOption("--to <email>")
  .option("--cc <emails>", "CC recipient(s), comma-separated")
  .option("--bcc <emails>", "BCC recipient(s), comma-separated")
  .requiredOption("--subject <subject>")
  .option("--body <text>")
  .option("--body-file <file>")
  .option("--attach <file...>")
  .option("--in <spec>", "schedule N minutes out, e.g. --in 30")
  .option("--at <iso>", "schedule at an ISO datetime")
  .action(async (opts) => {
    const prov = parseProvider(opts.provider);
    const body = readBody(opts);
    const attachments = resolveAttachments(opts.attach ?? []);
    const scheduleAt = parseScheduleAt(opts.in ?? opts.at);
    const result = await sendOneOff(
      prov,
      { to: opts.to, cc: opts.cc, bcc: opts.bcc, subject: opts.subject, body },
      attachments,
      scheduleAt,
      { onStatus: (m) => !isJson() && console.error(m) }
    );
    emit({ ok: result.success, provider: prov, to: opts.to, scheduledAt: scheduleAt?.toISOString() ?? null, ...result }, (d) =>
      console.log(`${d.provider} -> ${d.to}: ${d.status}${d.error ? " — " + d.error : ""}`)
    );
    await shutdown(result.success ? 0 : 2);
  });

// ---------------------------------------------------------------------------
// worker
// ---------------------------------------------------------------------------
program
  .command("worker")
  .description("Dispatch running campaigns (use --once for a single pass)")
  .option("--once", "run a single pass over running campaigns, then exit")
  .action(async (opts) => {
    const runOnce = async () => {
      const campaigns = await db.campaign.findMany({ where: { status: "running" } });
      const results: any[] = [];
      for (const c of campaigns) {
        const r = await tickCampaign(c).catch((e) => ({ sent: false, reason: String(e) }));
        results.push({ id: c.id, name: c.name, ...r });
        if (r.sent && !opts.once) {
          await new Promise((res) => setTimeout(res, getRandomDelay(c.minDelaySeconds, c.maxDelaySeconds) * 1000));
        }
      }
      return results;
    };

    if (opts.once) {
      const results = await runOnce();
      emit({ ok: true, results }, (d) => {
        for (const r of d.results) console.log(`${r.id} ${r.sent ? "SENT" : "skip:" + (r.reason ?? "")} ${r.name}`);
      });
      return shutdown();
    }

    if (!isJson()) console.error("Worker running. Ctrl+C to stop.");
    let stop = false;
    process.on("SIGINT", () => (stop = true));
    while (!stop) {
      await runOnce().catch((e) => console.error("cycle error", e));
      await new Promise((r) => setTimeout(r, 60_000));
    }
    await shutdown();
  });

program.parseAsync(process.argv).catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
