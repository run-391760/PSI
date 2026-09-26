"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { series } from "@/components/charts/theme";
import { IntentBadges, INTENT_META, KdBadge, KeywordLink } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Tooltip } from "@/components/ui/tooltip";
import { compact, money, num } from "@/lib/format";
import { KEYWORD_GAP_CATEGORIES, keywordGapCategories, type KeywordGapCategory } from "@/lib/competitive/gap-logic";
import type { GapKeyword } from "@/lib/competitive/keyword-gap";
import { INTENTS, type Intent } from "@/lib/seo/types";
import { cn } from "@/lib/utils";
import { SelectionButton } from "./auto-table";
import { inRange, KD_PRESETS, MultiFilter, POSITION_PRESETS, type Range, RangeFilter, SearchBox, TextFilter, VOLUME_PRESETS, words } from "./filters";

type Row = GapKeyword & { cats: KeywordGapCategory[] };

/** Keyword Gap table: category tabs (Shared/Missing/Weak/Strong/Untapped/Unique/All), filters, per-domain positions. */
export function KeywordGapTable({ rows, domains, db, counts, initialCat = "all", type }: { rows: GapKeyword[]; domains: string[]; db: string; counts: Record<KeywordGapCategory, number>; initialCat?: KeywordGapCategory; type: string }) {
  const [cat, setCat] = useState<KeywordGapCategory>(initialCat);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [vol, setVol] = useState<Range>({});
  const [kd, setKd] = useState<Range>({});
  const [you, setYou] = useState<Range>({});
  const [intents, setIntents] = useState<Intent[]>([]);

  const withCats = useMemo<Row[]>(() => rows.map((r) => ({ ...r, cats: keywordGapCategories(r.positions) })), [rows]);
  const filtered = useMemo(() => {
    const inc = include.trim().toLowerCase();
    const exc = words(exclude);
    return withCats.filter(
      (r) =>
        r.cats.includes(cat) &&
        (!inc || r.keyword.includes(inc)) &&
        (!exc.length || !exc.some((w) => r.keyword.includes(w))) &&
        inRange(r.volume, vol) &&
        inRange(r.kd, kd) &&
        inRange(r.positions[0], you) &&
        (!intents.length || r.intents.some((i) => intents.includes(i))),
    );
  }, [withCats, cat, include, exclude, vol, kd, you, intents]);
  const active = !!include || !!exclude || [vol.min, vol.max, kd.min, kd.max, you.min, you.max].some((v) => v != null) || intents.length > 0;

  const selectCat = (c: KeywordGapCategory) => {
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
    { key: "keyword", header: "Keyword", render: (r) => <KeywordLink keyword={r.keyword} db={db} /> },
    { key: "intents", header: "Intent", render: (r) => <IntentBadges intents={r.intents} />, sortValue: (r) => r.intents[0], csv: (r) => r.intents.join(", ") },
    ...domains.map<Column<Row>>((d, i) => ({
      key: `p${i}`,
      header: (
        <Tooltip content={`${i === 0 ? "You · " : ""}${d} position`}>
          <span className="inline-flex max-w-[120px] items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: series(i) }} aria-hidden />
            <span className="truncate">{d}</span>
          </span>
        </Tooltip>
      ),
      csvHeader: `${d} position`,
      align: "right",
      sortValue: (r) => r.positions[i],
      csv: (r) => r.positions[i] ?? "",
      render: (r) => {
        const p = r.positions[i];
        if (p == null) return <span className="text-text-3">–</span>;
        const ranked = r.positions.filter((x): x is number => x != null);
        const best = ranked.length > 1 && p === Math.min(...ranked);
        return <span className={cn("tabular", best && "font-semibold text-good-ink")}>{p}</span>;
      },
    })),
    { key: "volume", header: "Volume", align: "right", render: (r) => compact(r.volume) },
    { key: "kd", header: "KD %", align: "right", render: (r) => <KdBadge kd={r.kd} /> },
    { key: "cpc", header: "CPC", align: "right", render: (r) => money(r.cpc) },
    { key: "competition", header: "Com.", align: "right", render: (r) => num(r.competition, 2), info: "Paid search competition (0–1)" },
  ];

  const note = KEYWORD_GAP_CATEGORIES.find((c) => c.id === cat)?.note;

  return (
    <div>
      <div role="tablist" className="scroll-thin flex gap-1 overflow-x-auto border-b border-border px-4">
        {KEYWORD_GAP_CATEGORIES.map((c) => (
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
      <p className="px-4 pt-2.5 pb-2 text-[12.5px] text-text-3">
        {note} {filtered.length !== counts[cat] && <span className="text-text-2">Showing {filtered.length.toLocaleString()} after filters.</span>}
      </p>
      <DataTable<Row>
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.keyword}
        defaultSort={{ key: "volume", dir: "desc" }}
        exportName={`keyword-gap-${type}-${cat}-${domains[0]}`}
        selectable
        selectionActions={(selected) => <SelectionButton action={{ type: "keyword-list", key: "keyword", db }} rows={selected as unknown as Record<string, unknown>[]} />}
        pageSize={50}
        emptyText="No keywords in this category match the filters."
        toolbar={
          <>
            <SearchBox value={include} onChange={setInclude} placeholder="Include keyword" />
            <RangeFilter label={`${domains[0]} position`} value={you} onChange={setYou} presets={POSITION_PRESETS} />
            <RangeFilter label="Volume" value={vol} onChange={setVol} presets={VOLUME_PRESETS} />
            <RangeFilter label="KD %" value={kd} onChange={setKd} presets={KD_PRESETS} unit="0–100" />
            <MultiFilter label="Intent" value={intents} onChange={setIntents} options={INTENTS.map((i) => ({ value: i, text: INTENT_META[i].label, label: <span className="inline-flex items-center gap-2"><IntentBadges intents={[i]} />{INTENT_META[i].label}</span> }))} />
            <TextFilter label="Exclude" value={exclude} onChange={setExclude} placeholder="e.g. free, reddit" hint="Hides keywords containing any of these words." />
            {active && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInclude("");
                  setExclude("");
                  setVol({});
                  setKd({});
                  setYou({});
                  setIntents([]);
                }}
              >
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}
