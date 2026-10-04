"use client";

import Link from "next/link";
import { LocalTime } from "@/components/cx/publishing/posts-table";
import { ChannelChip } from "@/components/cx/publishing/shared";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import type { AbListItem } from "@/lib/cx/ops/ab";
import { abStatusTone } from "@/lib/cx/ops/ab-model";

/** Winner / leader badge: decided winner, significant leader, plain leader or n/a. */
export function OutcomeBadge({ r }: { r: Pick<AbListItem, "status" | "winner" | "leader" | "significant" | "clicksA" | "clicksB"> }) {
  if (r.winner === "a" || r.winner === "b") return <Badge tone="good">Winner {r.winner.toUpperCase()}</Badge>;
  if (r.winner === "none") return <Badge>No winner</Badge>;
  if (r.clicksA == null || r.clicksB == null) return <span className="text-text-3">n/a</span>;
  if (!r.leader) return <span className="text-[12.5px] text-text-3">{(r.clicksA ?? 0) + (r.clicksB ?? 0) ? "Tied" : "No clicks yet"}</span>;
  return r.significant ? <Badge tone="good">{r.leader.toUpperCase()} significant</Badge> : <Badge tone="info">{r.leader.toUpperCase()} leads</Badge>;
}

const fmt = (n: number | null) => (n == null ? <span className="text-text-3">n/a</span> : <span className="tabular">{n.toLocaleString("en-US")}</span>);

export function AbTestsTable({ brandId, rows }: { brandId: string; rows: AbListItem[] }) {
  const cols: Column<AbListItem>[] = [
    {
      key: "name",
      header: "Test",
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={`/cx/ab-testing/${r.id}?brand=${brandId}`} className="block max-w-[440px] min-w-[160px]">
          <span className="line-clamp-1 font-medium text-link hover:underline">{r.name}</span>
          {r.hypothesis && <span className="line-clamp-1 text-[12px] text-text-3">{r.hypothesis}</span>}
          {r.postsMissing && <span className="text-[12px] text-warning-ink">A variant post was deleted</span>}
        </Link>
      ),
      csv: (r) => r.name,
    },
    { key: "status", header: "Status", sortValue: (r) => r.label, render: (r) => <Badge tone={abStatusTone(r)}>{r.label}</Badge>, csv: (r) => r.label },
    {
      key: "channels",
      header: "Channels",
      sortable: false,
      hideOnMobile: true,
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.channels.map((c) => <ChannelChip key={c} kind={c} />)}
        </span>
      ),
      csv: (r) => r.channels.join("|"),
    },
    { key: "a", header: "A clicks", align: "right", sortValue: (r) => r.clicksA ?? -1, render: (r) => fmt(r.clicksA), csv: (r) => r.clicksA ?? "n/a" },
    { key: "b", header: "B clicks", align: "right", sortValue: (r) => r.clicksB ?? -1, render: (r) => fmt(r.clicksB), csv: (r) => r.clicksB ?? "n/a" },
    {
      key: "outcome",
      header: "Leader / winner",
      sortValue: (r) => (r.winner ?? (r.leader ? `${r.leader}${r.significant ? "!" : ""}` : "")),
      render: (r) => <OutcomeBadge r={r} />,
      csv: (r) => r.winner ?? (r.leader ? `${r.leader} leads${r.significant ? " (significant)" : ""}` : ""),
    },
    { key: "started", header: "Started", sortValue: (r) => r.startedAt ?? "", render: (r) => <LocalTime iso={r.startedAt} empty="Not started" />, csv: (r) => r.startedAt ?? "" },
    { key: "by", header: "Created by", hideOnMobile: true, sortValue: (r) => r.createdBy ?? "", render: (r) => r.createdBy ?? <span className="text-text-3">—</span> },
  ];
  return (
    <DataTable
      rows={rows}
      columns={cols}
      rowKey={(r) => r.id}
      searchable
      searchText={(r) => `${r.name} ${r.hypothesis} ${r.channels.join(" ")} ${r.label}`}
      searchPlaceholder="Filter tests"
      exportName="ab-tests"
      emptyText="No tests match."
      defaultSort={{ key: "started", dir: "desc" }}
    />
  );
}
