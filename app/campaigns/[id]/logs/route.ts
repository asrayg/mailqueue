import { db } from "@/lib/db";

/** Export this campaign's send logs as a CSV download. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const logs = await db.sendLog.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "asc" },
    include: { recipient: { select: { email: true } } },
  });

  const header = [
    "createdAt",
    "email",
    "provider",
    "status",
    "subject",
    "errorMessage",
  ];

  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const rows = logs.map((l) =>
    [
      l.createdAt.toISOString(),
      l.recipient?.email ?? "",
      l.provider,
      l.status,
      l.subject,
      l.errorMessage ?? "",
    ]
      .map(escape)
      .join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mailqueue-logs-${id}.csv"`,
    },
  });
}
