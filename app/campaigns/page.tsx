import Link from "next/link";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      recipients: { select: { status: true } },
    },
  });

  function counts(recipients: { status: string }[]) {
    const c = { sent: 0, failed: 0, skipped: 0, pending: 0 };
    for (const r of recipients) {
      if (r.status in c) (c as Record<string, number>)[r.status]++;
    }
    return c;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Campaigns</h1>
        <Link href="/campaigns/new" className="btn-primary">
          New Campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="card text-center text-slate-400">
          No campaigns yet.{" "}
          <Link href="/campaigns/new" className="text-accent hover:underline">
            Create your first campaign
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Failed</th>
                <th className="px-4 py-3">Skipped</th>
                <th className="px-4 py-3">Pending</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const ct = counts(c.recipients);
                return (
                  <tr
                    key={c.id}
                    className="border-t border-border bg-bg/40 hover:bg-panel"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize">{c.provider}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">{ct.sent}</td>
                    <td className="px-4 py-3">{ct.failed}</td>
                    <td className="px-4 py-3">{ct.skipped}</td>
                    <td className="px-4 py-3">{ct.pending}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {c.createdAt.toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
