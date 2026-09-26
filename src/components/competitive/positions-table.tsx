"use client";

import { Filter, X } from "lucide-react";
import { useMemo, useState } from "react";
import { IntentBadges, INTENT_META, KdBadge, KeywordLink, PositionChange, SerpFeatureIcons, TrendBars, featureLabel } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Segmented } from "@/components/ui/tabs";
import { compact, displayUrl, money, pct } from "@/lib/format";
import type { OrganicPosition } from "@/lib/competitive/organic-research";
import { INTENTS, SERP_FEATURES, type Intent, type SerpFeature } from "@/lib/seo/types";
import { SelectionButton } from "./auto-table";
import { ChoiceFilter, inRange, KD_PRESETS, MultiFilter, POSITION_PRESETS, type Range, RangeFilter, SearchBox, TextFilter, VOLUME_PRESETS, words } from "./filters";

type Brand = "all" | "branded" | "nonbranded";

/**
 * Organic Research › Positions: full keyword table with a Semrush-style filter bar
 * (position, volume, KD, intent, SERP features, include/exclude, branded) and URL drill-down.
 */
export function PositionsTable({ rows, db, domain, initialUrl = "", totalKeywords }: { rows: OrganicPosition[]; db: string; domain: string; initialUrl?: string; totalKeywords: number }) {
  const [pos, setPos] = useState<Range>({});
  const [vol, setVol] = useState<Range>({});
  const [kd, setKd] = useState<Range>({});
  const [intents, setIntents] = useState<Intent[]>([]);
  const [feature, setFeature] = useState<SerpFeature | "">("");
  const [owned, setOwned] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [brand, setBrand] = useState<Brand>("all");
  const [url, setUrl] = useState(initialUrl);

  const filtered = useMemo(() => {
    const inc = include.trim().toLowerCase();
    const exc = words(exclude);
    return rows.filter(
      (r) =>
        inRange(r.position, pos) &&
        inRange(r.volume, vol) &&
        inRange(r.kd, kd) &&
        (!intents.length || r.intents.some((i) => intents.includes(i))) &&
        (!feature || (owned ? r.ownedFeatures : r.serpFeatures).includes(feature)) &&
        (!inc || r.keyword.includes(inc)) &&
        (!exc.length || !exc.some((w) => r.keyword.includes(w))) &&
        (brand === "all" || (brand === "branded") === r.branded) &&
        (!url || r.url === url || r.url.startsWith(url)),
    );
  }, [rows, pos, vol, kd, intents, feature, owned, include, exclude, brand, url]);

  const active = [pos.min, pos.max, vol.min, vol.max, kd.min, kd.max].some((v) => v != null) || intents.length > 0 || !!feature || !!include || !!exclude || brand !== "all" || !!url;
  const clear = () => {
    setPos({});
    setVol({});
    setKd({});
    setIntents([]);
    setFeature("");
    setInclude("");
    setExclude("");
    setBrand("all");
    setUrl("");
  };
  const traffic = filtered.reduce((s, r) => s + r.traffic, 0);
  const allTraffic = rows.reduce((s, r) => s + r.traffic, 0) || 1;

  const columns: Column<OrganicPosition>[] = [
    {
      key: "keyword",
      header: "Keyword",
      render: (r) => (
        <span className="inline-flex max-w-[280px] items-center gap-1.5">
          <KeywordLink keyword={r.keyword} db={db} className="truncate" />
          {r.branded && (
            <Badge className="shrink-0" title="Branded keyword">
              B
            </Badge>
          )}
        </span>
      ),
    },
    { key: "intents", header: "Intent", render: (r) => <IntentBadges intents={r.intents} />, sortValue: (r) => r.intents[0], csv: (r) => r.intents.join(", ") },
    {
      key: "position",
      header: "Position",
      align: "right",
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="tabular" title={r.previousPosition != null ? `Last month: ${r.previousPosition}` : "New this month"}>
            {r.position}
          </span>
          <span className="inline-flex w-9">
            <PositionChange previous={r.previousPosition} current={r.position} compact />
          </span>
        </span>
      ),
    },
    { key: "serpFeatures", header: "SERP features", sortable: false, render: (r) => <SerpFeatureIcons features={r.serpFeatures} owned={r.ownedFeatures} max={4} />, csv: (r) => r.serpFeatures.map(featureLabel).join(", "), info: "Highlighted icons are features where this domain appears." },
    { key: "traffic", header: "Traffic", align: "right", render: (r) => compact(r.traffic) },
    { key: "trafficPct", header: "Traffic %", align: "right", render: (r) => pct(r.trafficPct, 2) },
    { key: "volume", header: "Volume", align: "right", render: (r) => compact(r.volume) },
    { key: "kd", header: "KD %", align: "right", render: (r) => <KdBadge kd={r.kd} /> },
    { key: "cpc", header: "CPC", align: "right", render: (r) => money(r.cpc) },
    {
      key: "url",
      header: "URL",
      render: (r) => (
        <span className="group inline-flex max-w-[230px] items-center gap-1">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="truncate text-link hover:underline" title={r.url}>
            {displayUrl(r.url)}
          </a>
          <button type="button" onClick={() => setUrl(r.url)} className="shrink-0 rounded p-0.5 text-text-3 opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-text focus:opacity-100" title="Show only this URL" aria-label="Filter by this URL">
            <Filter className="h-3 w-3" />
          </button>
        </span>
      ),
    },
    { key: "trend", header: "Trend", sortable: false, render: (r) => (r.trend.length ? <TrendBars values={r.trend} /> : <span className="text-text-3">n/a</span>), csv: (r) => r.trend.join("|") },
  ];

  return (
    <div>
      {url && (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
          <span className="text-text-2">Keywords for URL</span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="max-w-[520px] truncate font-medium text-link hover:underline">
            {displayUrl(url)}
          </a>
          <button type="button" onClick={() => setUrl("")} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-2 hover:bg-surface-3 hover:text-text">
            <X className="h-3 w-3" /> Show all URLs
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pb-2 text-[12.5px] text-text-2">
        <span>
          <span className="font-semibold text-text">{filtered.length.toLocaleString()}</span> keywords
          {active ? ` of ${rows.length.toLocaleString()}` : ""} in the analyzed sample
        </span>
        <span>
          Traffic <span className="font-semibold text-text">{compact(traffic)}</span> ({pct((traffic / allTraffic) * 100)} of sample)
        </span>
        <span className="text-text-3">Estimated total keywords for {domain}: {compact(totalKeywords)}</span>
      </div>
      <DataTable<OrganicPosition>
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.keyword}
        defaultSort={{ key: "traffic", dir: "desc" }}
        exportName={`${domain}-organic-positions-${db}`}
        selectable
        selectionActions={(selected) => <SelectionButton action={{ type: "keyword-list", key: "keyword", db }} rows={selected as unknown as Record<string, unknown>[]} />}
        pageSize={50}
        toolbar={
          <>
        <SearchBox value={include} onChange={setInclude} placeholder="Include keyword" />
        <RangeFilter label="Positions" value={pos} onChange={setPos} presets={POSITION_PRESETS} />
        <RangeFilter label="Volume" value={vol} onChange={setVol} presets={VOLUME_PRESETS} />
        <RangeFilter label="KD %" value={kd} onChange={setKd} presets={KD_PRESETS} unit="0–100" />
        <MultiFilter label="Intent" value={intents} onChange={setIntents} options={INTENTS.map((i) => ({ value: i, text: INTENT_META[i].label, label: <span className="inline-flex items-center gap-2"><IntentBadges intents={[i]} />{INTENT_META[i].label}</span> }))} />
        <ChoiceFilter label={owned ? "Domain in SERP feature" : "SERP features"} value={feature} onChange={setFeature} options={SERP_FEATURES.filter((f) => f.id !== "related_searches").map((f) => ({ value: f.id, label: f.label }))}>
          <div className="border-b border-border px-3 pb-2">
            <Segmented
              options={[
                { value: "serp", label: "SERP has" },
                { value: "owned", label: "Domain ranks in" },
              ]}
              value={owned ? "owned" : "serp"}
              onChange={(v) => setOwned(v === "owned")}
            />
          </div>
        </ChoiceFilter>
        <TextFilter label="Exclude" value={exclude} onChange={setExclude} placeholder="e.g. free, reddit" hint="Hides keywords containing any of these words." />
        <Segmented
          options={[
            { value: "all", label: "All" },
            { value: "nonbranded", label: "Non-branded" },
            { value: "branded", label: "Branded" },
          ]}
          value={brand}
          onChange={setBrand}
        />
        {active && (
          <Button size="sm" variant="ghost" onClick={clear}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
                </>
        }
      />
    </div>
  );
}
