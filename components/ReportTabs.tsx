"use client";

export type ReportTab = "weekly" | "monthly" | "yearly";

export default function ReportTabs({
  tab,
  onChange
}: {
  tab: ReportTab;
  onChange: (t: ReportTab) => void;
}) {
  const tabs: { id: ReportTab; label: string }[] = [
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
    { id: "yearly", label: "Yearly" }
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={[
              "px-4 py-2 rounded-full text-sm border",
              active ? "bg-zinc-900 text-white border-zinc-900" : "bg-white border-zinc-200 hover:bg-zinc-100"
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
