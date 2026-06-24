import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCampaignStats } from "@/lib/campaignService";
import { StatusBadge } from "@/components/StatusBadge";
import { formatLocal } from "@/lib/time";
import {
  pauseFromForm,
  resumeFromForm,
  cancelFromForm,
  retryFailedFromForm,
  sendTestFromForm,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CampaignDashboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) notFound();

  const stats = await getCampaignStats(id);
  const recipients = await db.recipient.findMany({
    where: { campaignId: id },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 200,
  });
  const recentLogs = await db.sendLog.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const lastSent = await db.sendLog.findFirst({
    where: { campaignId: id, status: "sent" },
    orderBy: { createdAt: "desc" },
  });
  const nextSendEstimate =
    campaign.status === "running" && lastSent
      ? new Date(lastSent.createdAt.getTime() + campaign.minDelaySeconds * 1000)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">
            ← All campaigns
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold text-white">
            {campaign.name} <StatusBadge status={campaign.status} />
          </h1>
          <p className="text-sm capitalize text-slate-400">
            {campaign.provider} · {campaign.maxPerDay}/day · {campaign.maxPerHour}/hr
            · delay {campaign.minDelaySeconds}-{campaign.maxDelaySeconds}s
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === "running" && (
            <FormButton action={pauseFromForm} id={id} label="Pause" variant="secondary" />
          )}
          {(campaign.status === "paused" || campaign.status === "confirmed") && (
            <FormButton action={resumeFromForm} id={id} label="Resume" variant="primary" />
          )}
          {stats.failed > 0 && (
            <FormButton
              action={retryFailedFromForm}
              id={id}
              label={`Retry ${stats.failed} failed`}
              variant="secondary"
            />
          )}
          {campaign.status !== "cancelled" && campaign.status !== "completed" && (
            <FormButton action={cancelFromForm} id={id} label="Cancel" variant="danger" />
          )}
          <a href={`/campaigns/${id}/logs`} className="btn-secondary">
            Export logs
          </a>
        </div>
      </div>

      {campaign.lastError && (
        <div className="card border-red-900 bg-red-950/30 text-sm text-red-200">
          <span className="font-semibold">Paused — last error:</span>{" "}
          {campaign.lastError}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Scheduled" value={stats.scheduled} />
        <StatCard label="Sent" value={stats.sent} />
        <StatCard label="Failed" value={stats.failed} />
        <StatCard label="Skipped" value={stats.skipped} />
        <StatCard label="Total" value={stats.total} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card text-sm">
          <div className="text-slate-400">Next send (estimate)</div>
          <div className="mt-1 font-medium text-slate-100">
            {nextSendEstimate
              ? formatLocal(nextSendEstimate, campaign.timezone)
              : campaign.status === "running"
                ? "Within the next minute"
                : "—"}
          </div>
        </div>
        <div className="card text-sm">
          <div className="text-slate-400">Worker status</div>
          <div className="mt-1 text-slate-300">
            Sends only run while <code className="text-accent">npm run worker</code>{" "}
            is running.
          </div>
        </div>
      </div>

      {/* Test send (also available on running campaigns) */}
      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-white">Send a test email</h2>
        <form action={sendTestFromForm} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="campaignId" value={id} />
          <div className="flex-1">
            <input id="to" name="to" type="email" placeholder="you@example.com (optional)" className="input" />
          </div>
          <button type="submit" className="btn-secondary">
            Send Test
          </button>
        </form>
      </div>

      {/* Recipients */}
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">
          Recipients{" "}
          <span className="text-sm font-normal text-slate-500">
            (showing up to 200)
          </span>
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-slate-400">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Sent at</th>
                <th className="px-4 py-2">Last error</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-t border-border bg-bg/40">
                  <td className="px-4 py-2 text-slate-200">{r.email}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-slate-400">
                    {r.sentAt ? formatLocal(r.sentAt, campaign.timezone) : "—"}
                  </td>
                  <td className="px-4 py-2 text-red-300">
                    {r.failureReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent logs */}
      <div>
        <h2 className="mb-2 text-lg font-semibold text-white">Recent activity</h2>
        <div className="space-y-1 text-sm">
          {recentLogs.length === 0 ? (
            <p className="text-slate-400">No activity yet.</p>
          ) : (
            recentLogs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-md border border-border bg-bg/40 px-3 py-1.5"
              >
                <span className="flex items-center gap-2">
                  <StatusBadge status={l.status} />
                  <span className="text-slate-300">{l.subject}</span>
                </span>
                <span className="text-xs text-slate-500">
                  {l.errorMessage ? (
                    <span className="text-red-400">{l.errorMessage}</span>
                  ) : null}{" "}
                  {formatLocal(l.createdAt, campaign.timezone)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card py-3 text-center">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function FormButton({
  action,
  id,
  label,
  variant,
}: {
  action: (form: FormData) => Promise<void>;
  id: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
}) {
  return (
    <form action={action}>
      <input type="hidden" name="campaignId" value={id} />
      <button type="submit" className={`btn-${variant}`}>
        {label}
      </button>
    </form>
  );
}
