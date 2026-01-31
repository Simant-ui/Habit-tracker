"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from "recharts";

export default function LineGraph({
  data,
  xKey,
  yKey,
  yLabel
}: {
  data: any[];
  xKey: string;
  yKey: string;
  yLabel: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-sm text-zinc-600 mb-3">{yLabel}</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xKey} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: any) => `${Math.round(Number(v))}%`} />
            <Line type="monotone" dataKey={yKey} strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
