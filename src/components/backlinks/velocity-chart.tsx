"use client";

import { ScrollSegmented } from "./table-tools";
import { useMemo, useState } from "react";
import type { VelocityPoint } from "@/lib/backlinks/types";
import { compact } from "@/lib/format";
import { BarChart } from "@/components/charts/bar-chart";

/** New vs lost referring domains / backlinks per day, 30 or 90 days. Lost is drawn below zero. */
export function VelocityChart({ data, height = 230 }: { data: VelocityPoint[]; height?: number }) {
  const [metric, setMetric] = useState<"rd" | "bl">("rd");
  const [days, setDays] = useState<"30" | "90">("30");
  const rows = useMemo(
    () =>
      data.slice(-Number(days)).map((p) => ({
        date: p.date,
        new: metric === "rd" ? p.newReferringDomains : p.newBacklinks,
        lost: -(metric === "rd" ? p.lostReferringDomains : p.lostBacklinks),
      })),
    [data, metric, days],
  );
  const totals = rows.reduce((a, r) => ({ new: a.new + r.new, lost: a.lost - r.lost }), { new: 0, lost: 0 });
  const net = totals.new - totals.lost;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ScrollSegmented<"rd" | "bl">
          value={metric}
          onChange={setMetric}
          options={[
            { value: "rd", label: "Referring domains" },
            { value: "bl", label: "Backlinks" },
          ]}
        />
        <ScrollSegmented<"30" | "90">
          value={days}
          onChange={setDays}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
      </div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        <span className="text-text-2">
          New <span className="tabular font-semibold text-good-ink">+{compact(totals.new)}</span>
        </span>
        <span className="text-text-2">
          Lost <span className="tabular font-semibold text-critical-ink">−{compact(totals.lost)}</span>
        </span>
        <span className="text-text-2">
          Net{" "}
          <span className="tabular font-semibold text-text">
            {net >= 0 ? "+" : "−"}
            {compact(Math.abs(net))}
          </span>
        </span>
      </div>
      <BarChart
        data={rows}
        xKey="date"
        xFormat="day"
        series={[
          { key: "new", label: "New", color: "var(--good)" },
          { key: "lost", label: "Lost", color: "var(--critical)" },
        ]}
        height={height}
      />
    </div>
  );
}
