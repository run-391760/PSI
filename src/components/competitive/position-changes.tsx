"use client";

import { useMemo, useState } from "react";
import { IntentBadges, KdBadge, KeywordLink, PositionChange } from "@/components/seo/badges";
import { type Column, DataTable } from "@/components/ui/data-table";
import { compact, displayUrl, money, signed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SelectionButton } from "./auto-table";
import { SearchBox } from "./filters";
import { CHANGE_META, CHANGE_ORDER as ORDER, type ChangeKind } from "./change-meta";

export type { ChangeKind };

export type ChangeRow = {
  keyword: string;
  type: ChangeKind;
  position: number | null;
  previousPosition: number | null;
  volume: number;
  kd?: number;
  cpc: number;
  intents?: string[];
  traffic: number;
  trafficChange: number;
  url: string;
};

/** Position changes tables (one per change type) with counts, quick filter, CSV and add-to-list. */
export function PositionChangesTables({ rows, db, exportName, initial = "improved" }: { rows: ChangeRow[]; db: string; exportName: string; initial?: ChangeKind }) {
  const [type, setType] = useState<ChangeKind>(initial);
  const [q, setQ] = useState("");
  const counts = useMemo(() => Object.fromEntries(ORDER.map((t) => [t, rows.filter((r) => r.type === t).length])) as Record<ChangeKind, number>, [rows]);
  const visible = useMemo(() => rows.filter((r) => r.type === type && (!q || r.keyword.includes(q.toLowerCase()))), [rows, type, q]);

  const columns: Column<ChangeRow>[] = [
    { key: "keyword", header: "Keyword", render: (r) => <KeywordLink keyword={r.keyword} db={db} /> },
    ...(rows.some((r) => r.intents)
      ? [{ key: "intents", header: "Intent", render: (r: ChangeRow) => <IntentBadges intents={(r.intents ?? []) as never} />, sortValue: (r: ChangeRow) => r.intents?.[0], csv: (r: ChangeRow) => (r.intents ?? []).join(", ") }]
      : []),
    { key: "position", header: "Position", align: "right", render: (r) => (r.position == null ? <span className="text-critical-ink">Lost</span> : r.position) },
    { key: "previousPosition", header: "Previous", align: "right", render: (r) => (r.previousPosition == null ? <span className="text-text-3">–</span> : r.previousPosition) },
    { key: "change", header: "Change", align: "right", sortValue: (r) => (r.previousPosition != null && r.position != null ? r.previousPosition - r.position : null), csv: (r) => (r.previousPosition != null && r.position != null ? r.previousPosition - r.position : type), render: (r) => <PositionChange previous={r.previousPosition} current={r.position} /> },
    { key: "volume", header: "Volume", align: "right", render: (r) => compact(r.volume) },
    ...(rows.some((r) => r.kd != null) ? [{ key: "kd", header: "KD %", align: "right" as const, render: (r: ChangeRow) => <KdBadge kd={r.kd} /> }] : []),
    { key: "cpc", header: "CPC", align: "right", render: (r) => money(r.cpc) },
    {
      key: "trafficChange",
      header: "Traffic change",
      align: "right",
      render: (r) => <span className={cn("tabular font-medium", r.trafficChange > 0 ? "text-good-ink" : r.trafficChange < 0 ? "text-critical-ink" : "text-text-3")}>{signed(r.trafficChange)}</span>,
    },
    {
      key: "url",
      header: "URL",
      render: (r) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-[260px] truncate text-link hover:underline" title={r.url}>
            {displayUrl(r.url.split("?")[0])}
          </a>
        ) : (
          <span className="text-text-3">n/a</span>
        ),
    },
  ];

  return (
    <div>
      <div role="tablist" className="scroll-thin flex gap-1 overflow-x-auto border-b border-border px-4">
        {ORDER.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-medium whitespace-nowrap", type === t ? "border-brand text-text" : "border-transparent text-text-2 hover:text-text")}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: CHANGE_META[t].color }} aria-hidden />
            {CHANGE_META[t].label}
            <span className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{counts[t].toLocaleString()}</span>
          </button>
        ))}
      </div>
<div className="h-3" />
      <DataTable<ChangeRow>
        rows={visible}
        columns={columns}
        rowKey={(r) => `${r.type}:${r.keyword}`}
        defaultSort={{ key: "volume", dir: "desc" }}
        exportName={`${exportName}-${type}`}
        selectable
        selectionActions={(selected) => <SelectionButton action={{ type: "keyword-list", key: "keyword", db }} rows={selected as unknown as Record<string, unknown>[]} />}
        emptyText={`No ${CHANGE_META[type].label.toLowerCase()} keywords.`}
        toolbar={
          <>
            <SearchBox value={q} onChange={setQ} />
            <span className="text-[12.5px] text-text-3">{CHANGE_META[type].note}</span>
          </>
        }
      />
    </div>
  );
}
