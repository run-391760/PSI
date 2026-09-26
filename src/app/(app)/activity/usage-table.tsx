"use client";

import { dateTimeLabel } from "@/lib/format";
import type { UsageEvent } from "@/lib/reports/platform";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";

const usd = (micros: string | null) => (micros == null ? null : Number(micros) / 1e6);
const fmt = (v: number | null) => (v == null ? "n/a" : `$${v.toFixed(v < 1 ? 4 : 2)}`);
const STATUS: Record<string, { label: string; tone: "neutral" | "good" | "warning" | "critical" | "info" }> = {
  reserved: { label: "Reserved", tone: "info" },
  reported: { label: "Charged", tone: "good" },
  provider_error: { label: "Provider error", tone: "critical" },
  check_provider: { label: "Check provider", tone: "warning" },
};

const columns: Column<UsageEvent>[] = [
  { key: "created_at", header: "Time", sortValue: (r) => r.created_at, render: (r) => <span className="whitespace-nowrap text-text-2">{dateTimeLabel(r.created_at)}</span> },
  { key: "endpoint", header: "Endpoint", render: (r) => <span className="font-mono text-[12px] break-all text-text">{r.endpoint}</span> },
  { key: "reserved", header: "Reserved", align: "right", sortValue: (r) => usd(r.reserved_micros), csv: (r) => usd(r.reserved_micros), render: (r) => fmt(usd(r.reserved_micros)), info: "Worst-case cost reserved against your budget before the call." },
  { key: "actual", header: "Actual cost", align: "right", sortValue: (r) => usd(r.actual_micros), csv: (r) => usd(r.actual_micros), render: (r) => fmt(usd(r.actual_micros)), info: "Cost reported by the provider." },
  { key: "status", header: "Status", render: (r) => <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge> },
];

export function UsageTable({ rows }: { rows: UsageEvent[] }) {
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "created_at", dir: "desc" }} searchable searchPlaceholder="Filter endpoints" searchText={(r) => `${r.endpoint} ${r.status}`} exportName="api-usage" emptyText="No paid API calls yet. Calls appear here when a live provider is used." />;
}
