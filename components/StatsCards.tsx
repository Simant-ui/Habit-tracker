"use client";

export default function StatsCards({
  completionPct,
  bestHabit,
  worstHabit
}: {
  completionPct: number;
  bestHabit: string | null;
  worstHabit: string | null;
}) {
  return (
    <div className="grid md:grid-cols-3 gap-3">
      <div className="card p-4">
        <div className="text-sm text-zinc-500">Completion</div>
        <div className="text-2xl font-semibold">{Math.round(completionPct)}%</div>
      </div>

      <div className="card p-4">
        <div className="text-sm text-zinc-500">Best (7-day)</div>
        <div className="text-lg font-semibold truncate">{bestHabit ?? "—"}</div>
      </div>

      <div className="card p-4">
        <div className="text-sm text-zinc-500">Worst (7-day)</div>
        <div className="text-lg font-semibold truncate">{worstHabit ?? "—"}</div>
      </div>
    </div>
  );
}
