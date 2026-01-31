"use client";

import type { DayLog, Habit, HabitStatus } from "@/lib/types";

export default function HabitList({
  habits,
  log,
  onChangeStatus,
  saving
}: {
  habits: Habit[];
  log: DayLog | null; // ✅ prop name "log" यही हुनुपर्छ
  onChangeStatus: (habitId: string, next: HabitStatus) => void;
  saving?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold">Daily Habits</h2>
        {saving ? <span className="text-xs text-zinc-500">Saving...</span> : null}
      </div>

      <div className="space-y-3">
        {habits.length === 0 ? (
          <div className="text-sm text-zinc-600">
            Active habits छैनन्। Habits page बाट enable गर्नुहोस्।
          </div>
        ) : null}

        {habits.map((h) => {
          const current = log?.habitStatus?.[h.id] ?? { status: "none", count: 0 };
          const numeric = h.targetValue > 1;

          return (
            <div
              key={h.id}
              className="flex items-center justify-between gap-3 border border-zinc-100 rounded-2xl p-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{h.title}</div>
                <div className="text-xs text-zinc-500">
                  Target: {h.targetType} • {h.targetValue}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {numeric ? (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={current.count ?? 0}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value || 0));
                        onChangeStatus(h.id, {
                          status: val >= h.targetValue ? "done" : "none",
                          count: val
                        });
                      }}
                      className="w-24 px-3 py-2 rounded-xl border border-zinc-200 text-sm"
                    />
                    <span className="text-xs text-zinc-500">/ {h.targetValue}</span>
                  </>
                ) : (
                  <label className="flex items-center gap-2 text-sm select-none">
                    <input
                      type="checkbox"
                      checked={current.status === "done"}
                      onChange={(e) =>
                        onChangeStatus(h.id, {
                          status: e.target.checked ? "done" : "none",
                          count: e.target.checked ? 1 : 0
                        })
                      }
                      className="h-5 w-5"
                    />
                    Done
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
