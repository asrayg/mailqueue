const STYLES: Record<string, string> = {
  draft: "bg-slate-800 text-slate-300",
  confirmed: "bg-indigo-950 text-indigo-300",
  running: "bg-green-950 text-green-300",
  paused: "bg-amber-950 text-amber-300",
  completed: "bg-blue-950 text-blue-300",
  cancelled: "bg-slate-800 text-slate-400",
  // recipient statuses
  pending: "bg-slate-800 text-slate-300",
  scheduled: "bg-indigo-950 text-indigo-300",
  sent: "bg-green-950 text-green-300",
  failed: "bg-red-950 text-red-300",
  skipped: "bg-amber-950 text-amber-300",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STYLES[status] ?? "bg-slate-800 text-slate-300"}`}>
      {status}
    </span>
  );
}
