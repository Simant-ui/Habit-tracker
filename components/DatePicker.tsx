"use client";

export default function DatePicker({
  value,
  onChange
}: {
  value: string; // yyyy-mm-dd
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-zinc-600">Date</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm"
      />
    </div>
  );
}
