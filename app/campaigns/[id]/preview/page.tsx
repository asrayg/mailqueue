import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { previewEmails, parseAttachmentPaths, parseSendDays } from "@/lib/campaignService";
import { checkFiles } from "@/lib/hashing";
import { estimateCompletion, formatLocal } from "@/lib/time";
import { confirmFromForm, sendTestFromForm } from "@/app/actions";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) notFound();

  const total = await db.recipient.count({ where: { campaignId: id } });
  const previews = await previewEmails(id, 5);
  const attachmentPaths = parseAttachmentPaths(campaign.attachmentPaths);
  const fileChecks = checkFiles(attachmentPaths);
  const missingFiles = fileChecks.filter((f) => !f.exists || f.tooLarge);
  const days = parseSendDays(campaign.sendDaysJson);

  const anyMissingVars = previews.some((p) => p.missingVars.length > 0);
  const finish = estimateCompletion(total, campaign.maxPerDay, new Date());

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">
          ← All campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Review: {campaign.name}
        </h1>
        <p className="text-sm text-slate-400">
          Nothing has been sent. Review everything below, send a test, then confirm.
        </p>
      </div>

      <div className="card grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Recipients" value={total} />
        <Stat label="Provider" value={campaign.provider} />
        <Stat label="Daily cap" value={`${campaign.maxPerDay}/day`} />
        <Stat label="Hourly cap" value={`${campaign.maxPerHour}/hr`} />
        <Stat
          label="Delay range"
          value={`${campaign.minDelaySeconds}-${campaign.maxDelaySeconds}s`}
        />
        <Stat
          label="Est. finish"
          value={formatLocal(finish, campaign.timezone).split(" ")[0]}
        />
      </div>

      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-white">Sending window</h2>
        <p className="text-sm text-slate-300">
          {campaign.sendingWindowStart}–{campaign.sendingWindowEnd}{" "}
          {campaign.timezone} on{" "}
          {days.map((d) => DAY_NAMES[d]).join(", ")}
        </p>
      </div>

      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-white">Attachments</h2>
        {attachmentPaths.length === 0 ? (
          <p className="text-sm text-slate-400">None</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {fileChecks.map((f) => (
              <li key={f.path} className="flex items-center gap-2">
                <span className="text-slate-200">{f.path.split("/").pop()}</span>
                {!f.exists ? (
                  <span className="badge bg-red-950 text-red-300">missing</span>
                ) : f.tooLarge ? (
                  <span className="badge bg-red-950 text-red-300">too large</span>
                ) : (
                  <span className="text-xs text-slate-500">
                    {(f.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(anyMissingVars || missingFiles.length > 0 || total === 0) && (
        <div className="card border-amber-900 bg-amber-950/30">
          <h2 className="mb-2 text-lg font-semibold text-amber-300">Warnings</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-amber-200">
            {total === 0 && <li>No recipients imported — upload a CSV first.</li>}
            {anyMissingVars && (
              <li>
                Some emails have missing template variables (shown blank below).
              </li>
            )}
            {missingFiles.length > 0 && (
              <li>
                {missingFiles.length} attachment(s) are missing or too large —
                sending is blocked until fixed.
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold text-white">
          First {previews.length} generated emails
        </h2>
        <div className="space-y-4">
          {previews.map((p, i) => (
            <div key={i} className="rounded-md border border-border bg-bg p-4">
              <div className="mb-1 text-xs text-slate-500">To: {p.email}</div>
              <div className="mb-2 font-medium text-slate-100">
                {p.subject || <span className="text-slate-500">(empty subject)</span>}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300">
                {p.body}
              </pre>
              {p.missingVars.length > 0 && (
                <div className="mt-2 text-xs text-amber-400">
                  Missing: {p.missingVars.map((v) => `{{${v}}}`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Test send */}
      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-white">Send a test first</h2>
        <p className="mb-3 text-sm text-slate-400">
          Sends one email to yourself using the first recipient&apos;s variables. A
          browser window opens — make sure you&apos;re logged into {campaign.provider}.
        </p>
        <form action={sendTestFromForm} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="flex-1">
            <label className="label" htmlFor="to">
              Test recipient (defaults to your TEST_RECIPIENT_EMAIL)
            </label>
            <input id="to" name="to" type="email" placeholder="you@example.com" className="input" />
          </div>
          <button type="submit" className="btn-secondary">
            Send Test Email
          </button>
        </form>
      </div>

      {/* Confirm */}
      <form action={confirmFromForm} className="card flex items-center justify-between">
        <input type="hidden" name="campaignId" value={campaign.id} />
        <div className="text-sm text-slate-400">
          Confirming starts the campaign. The worker sends gradually within your
          window and caps.
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={total === 0 || missingFiles.length > 0}
        >
          Confirm and Start
        </button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium capitalize text-slate-100">{value}</div>
    </div>
  );
}
