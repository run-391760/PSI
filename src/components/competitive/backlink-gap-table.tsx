"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { series } from "@/components/charts/theme";
import { AsBadge, DomainAvatar } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Tooltip } from "@/components/ui/tooltip";
import { compact } from "@/lib/format";
import type { BacklinkGapRow } from "@/lib/competitive/backlink-gap";
import { BACKLINK_GAP_CATEGORIES, backlinkGapCategories, type BacklinkGapCategory } from "@/lib/competitive/gap-logic";
import { cn } from "@/lib/utils";
import { SelectionButton } from "./auto-table";
import { inRange, type Range, RangeFilter, SearchBox } from "./filters";

type Row = BacklinkGapRow & { cats: BacklinkGapCategory[] };

const AS_PRESETS = [
  { label: "80–100", min: 80, max: 100 },
  { label: "60–79", min: 60, max: 79 },
  { label: "40–59", min: 40, max: 59 },
  { label: "20–39", min: 20, max: 39 },
  { label: "0–19", min: 0, max: 19 },
];

/** Backlink Gap table: category tabs (Best/Weak/Strong/Shared/Unique/All), AS filter, per-target backlink counts. */
export function BacklinkGapTable({ rows, targets, counts, initialCat = "best" }: { rows: BacklinkGapRow[]; targets: string[]; counts: Record<BacklinkGapCategory, number>; initialCat?: BacklinkGapCategory }) {
  const [cat, setCat] = useState<BacklinkGapCategory>(initialCat);
  const [q, setQ] = useState("");
  const [as, setAs] = useState<Range>({});
  const withCats = useMemo<Row[]>(() => rows.map((r) => ({ ...r, cats: backlinkGapCategories(r.counts) })), [rows]);
  const filtered = useMemo(() => withCats.filter((r) => r.cats.includes(cat) && (!q || r.domain.includes(q.toLowerCase())) && inRange(r.authorityScore, as)), [withCats, cat, q, as]);

  const selectCat = (c: BacklinkGapCategory) => {
    setCat(c);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("cat", c);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* ignore */
    }
  };

  const columns: Column<Row>[] = [
    {
      key: "domain",
      header: "Referring domain",
      render: (r) => (
        <Link href={`/backlink-analytics?q=${encodeURIComponent(r.domain)}`} className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline">
          <DomainAvatar domain={r.domain} />
          <span className="max-w-[240px] truncate">{r.domain}</span>
        </Link>
      ),
    },
    { key: "authorityScore", header: "AS", align: "right", render: (r) => (r.authorityScore == null ? <span className="text-text-3">n/a</span> : <AsBadge score={r.authorityScore} />), info: "Authority Score of the referring domain" },
    {
      key: "matches",
      header: "Matches",
      align: "right",
      info: "Number of the compared domains it links to",
      csv: (r) => r.matches,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <span className="inline-flex gap-0.5">
            {r.counts.map((c, i) => (
              <span key={i} className="h-2.5 w-1.5 rounded-sm" style={{ background: c > 0 ? series(i) : "var(--surface-3)" }} aria-hidden />
            ))}
          </span>
          <span className="tabular w-8 text-right">
            {r.matches}/{targets.length}
          </span>
        </span>
      ),
    },
    ...targets.map<Column<Row>>((d, i) => ({
      key: `t${i}`,
      header: (
        <Tooltip content={`Backlinks to ${d}${i === 0 ? " (you)" : ""}`}>
          <span className="inline-flex max-w-[120px] items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: series(i) }} aria-hidden />
            <span className="truncate">{d}</span>
          </span>
        </Tooltip>
      ),
      csvHeader: `Backlinks to ${d}`,
      align: "right",
      sortValue: (r) => r.counts[i],
      csv: (r) => r.counts[i],
      render: (r) => (r.counts[i] > 0 ? <span className={cn("tabular", i === 0 && "font-medium")}>{compact(r.counts[i])}</span> : <span className="text-text-3">–</span>),
    })),
  ];

  return (
    <div>
      <div role="tablist" className="scroll-thin flex gap-1 overflow-x-auto border-b border-border px-4">
        {BACKLINK_GAP_CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cat === c.id}
            title={c.note}
            onClick={() => selectCat(c.id)}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-medium whitespace-nowrap", cat === c.id ? "border-brand text-text" : "border-transparent text-text-2 hover:text-text")}
          >
            {c.label}
            <span className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{compact(counts[c.id] ?? 0)}</span>
          </button>
        ))}
      </div>
      <p className="px-4 pt-2.5 pb-2 text-[12.5px] text-text-3">{BACKLINK_GAP_CATEGORIES.find((c) => c.id === cat)?.note}</p>
      <DataTable<Row>
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.domain}
        defaultSort={{ key: "authorityScore", dir: "desc" }}
        exportName={`backlink-gap-${cat}-${targets[0]}`}
        selectable
        selectionActions={(selected, clear) => <SelectionButton action={{ type: "copy", key: "domain", label: "Copy domains" }} rows={selected as unknown as Record<string, unknown>[]} clear={clear} />}
        pageSize={50}
        emptyText="No referring domains in this category match the filters."
        toolbar={
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Filter by domain" />
            <RangeFilter label="Authority Score" value={as} onChange={setAs} presets={AS_PRESETS} unit="0–100" />
            {(q || as.min != null || as.max != null) && (
              <Button size="sm" variant="ghost" onClick={() => (setQ(""), setAs({}))}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}
