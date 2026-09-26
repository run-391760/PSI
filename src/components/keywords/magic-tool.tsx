"use client";

import { Copy, ListFilter, ListPlus, Megaphone, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { compact, money } from "@/lib/format";
import { decodeFeatures, decodeIntents, featureBit, type IdeaRow, type MatchType } from "@/lib/keywords/types";
import { kwTokens, rowHasWord, stem, wordGroups } from "@/lib/keywords/text";
import { INTENTS, SERP_FEATURES, type Intent, type SerpFeature } from "@/lib/seo/types";
import { cn } from "@/lib/utils";
import { INTENT_META, KD_BANDS, KdBadge, IntentBadges, KeywordLink, SerpFeatureIcons, TrendBars, featureLabel, FeatureIcon, kdBand } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Checkbox, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { AddToListDialog } from "./add-to-list";
import { FilterMenu, RangePicker, emptyRange, inRange, rangeSummary, type Range } from "./filter-menu";

type Filters = {
  volume: Range;
  kd: Range;
  cpc: Range;
  words: Range;
  intents: Intent[];
  features: SerpFeature[];
  include: string;
  includeMode: "any" | "all";
  exclude: string;
  acOnly: boolean;
};
const EMPTY: Filters = { volume: emptyRange, kd: emptyRange, cpc: emptyRange, words: emptyRange, intents: [], features: [], include: "", includeMode: "any", exclude: "", acOnly: false };

const VOLUME_PRESETS = [
  { label: "100,001+", range: { min: 100001, max: null } },
  { label: "10,001–100,000", range: { min: 10001, max: 100000 } },
  { label: "1,001–10,000", range: { min: 1001, max: 10000 } },
  { label: "101–1,000", range: { min: 101, max: 1000 } },
  { label: "11–100", range: { min: 11, max: 100 } },
  { label: "1–10", range: { min: 1, max: 10 } },
];
const KD_PRESETS = KD_BANDS.map((b, i) => ({ label: `${b.label} ${i === 0 ? 0 : KD_BANDS[i - 1].max + 1}–${b.max}%`, range: { min: i === 0 ? 0 : KD_BANDS[i - 1].max + 1, max: b.max } }));
const WORD_PRESETS = [
  { label: "1–2 words (head terms)", range: { min: 1, max: 2 } },
  { label: "3–4 words", range: { min: 3, max: 4 } },
  { label: "5+ words (long tail)", range: { min: 5, max: null } },
];
const CPC_PRESETS = [
  { label: "$0 – $0.50", range: { min: 0, max: 0.5 } },
  { label: "$0.51 – $2", range: { min: 0.51, max: 2 } },
  { label: "$2.01 – $5", range: { min: 2.01, max: 5 } },
  { label: "$5+", range: { min: 5, max: null } },
];

const words = (s: string) => kwTokens(s).map(stem);

export function MagicTool({
  seed,
  db,
  match,
  rows,
  total,
  truncated,
  hasAutocomplete,
}: {
  seed: string;
  db: string;
  match: MatchType;
  rows: IdeaRow[];
  total: number;
  truncated: boolean;
  hasAutocomplete: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(EMPTY);
  const [group, setGroup] = useState<string | null>(null);
  const [groupSort, setGroupSort] = useState<"count" | "volume">("count");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [dialog, setDialog] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  const filtered = useMemo(() => {
    const inc = words(f.include);
    const exc = words(f.exclude);
    const featMask = f.features.reduce((m, x) => m | featureBit(x), 0);
    return rows.filter((r) => {
      if (!inRange(r.volume, f.volume) || !inRange(r.kd, f.kd) || !inRange(r.cpc, f.cpc) || !inRange(r.words, f.words)) return false;
      if (f.acOnly && !r.ac) return false;
      if (f.intents.length && !decodeIntents(r.i).some((i) => f.intents.includes(i))) return false;
      if (featMask && !(r.f & featMask)) return false;
      if (inc.length || exc.length) {
        const w = new Set(words(r.keyword));
        if (inc.length && !(f.includeMode === "all" ? inc.every((t) => w.has(t)) : inc.some((t) => w.has(t)))) return false;
        if (exc.some((t) => w.has(t))) return false;
      }
      return true;
    });
  }, [rows, f]);

  const groups = useMemo(() => {
    const g = wordGroups(filtered, seed, 80);
    return groupSort === "volume" ? [...g].sort((a, b) => b.volume - a.volume) : g;
  }, [filtered, seed, groupSort]);
  const visible = useMemo(() => (group ? filtered.filter((r) => rowHasWord(r.keyword, group)) : filtered), [filtered, group]);
  const totals = useMemo(() => {
    const vol = visible.reduce((s, r) => s + (r.volume ?? 0), 0);
    const kds = visible.filter((r) => r.kd != null);
    return { vol, kd: kds.length ? Math.round(kds.reduce((s, r) => s + (r.kd ?? 0), 0) / kds.length) : null, ac: visible.filter((r) => r.ac).length };
  }, [visible]);
  const activeCount = [f.volume.min != null || f.volume.max != null, f.kd.min != null || f.kd.max != null, f.cpc.min != null || f.cpc.max != null, f.words.min != null || f.words.max != null, f.intents.length > 0, f.features.length > 0, !!f.include.trim(), !!f.exclude.trim(), f.acOnly].filter(Boolean).length;

  const columns = useMemo<Column<IdeaRow>[]>(() => {
    const cols: Column<IdeaRow>[] = [
      {
        key: "keyword",
        header: "Keyword",
        sortValue: (r) => r.keyword,
        render: (r) => (
          <span className="inline-flex max-w-[320px] items-center gap-1.5">
            <KeywordLink keyword={r.keyword} db={db} className="truncate" />
            {r.ac && (
              <Tooltip content="Real Google Autocomplete suggestion">
                <span className="inline-flex h-4 items-center rounded bg-good-soft px-1 text-[10px] font-semibold text-good-ink">AC</span>
              </Tooltip>
            )}
          </span>
        ),
        csv: (r) => r.keyword,
      },
    ];
    if (match === "related")
      cols.push({ key: "rel", header: "Related %", align: "right", info: "Share of the seed keyword's Google top-10 domains that also rank for this keyword.", sortValue: (r) => r.rel ?? null, render: (r) => (r.rel == null ? <span className="text-text-3">n/a</span> : `${r.rel}%`) });
    cols.push(
      { key: "intent", header: "Intent", sortValue: (r) => r.i, render: (r) => <IntentBadges intents={decodeIntents(r.i)} />, csv: (r) => decodeIntents(r.i).map((i) => INTENT_META[i].label).join("; ") },
      { key: "volume", header: "Volume", align: "right", sortValue: (r) => r.volume, render: (r) => (r.volume == null ? <span className="text-text-3">n/a</span> : r.volume.toLocaleString()) },
      { key: "trend", header: "Trend", sortable: false, csvHeader: "Trend (relative, 12 months)", render: (r) => (r.t.length ? <TrendBars values={r.t} width={56} height={16} /> : <span className="text-text-3">n/a</span>), csv: (r) => r.t.join(" ") },
      { key: "kd", header: "KD %", align: "right", sortValue: (r) => r.kd, render: (r) => <KdBadge kd={r.kd} /> },
      { key: "cpc", header: "CPC (USD)", align: "right", sortValue: (r) => r.cpc, render: (r) => (r.cpc == null ? <span className="text-text-3">n/a</span> : money(r.cpc)) },
      { key: "competition", header: "Com.", align: "right", info: "Competitive density of advertisers (0–1).", sortValue: (r) => r.competition, render: (r) => (r.competition == null ? <span className="text-text-3">n/a</span> : r.competition.toFixed(2)) },
      { key: "features", header: "SERP features", sortValue: (r) => decodeFeatures(r.f).length, render: (r) => <SerpFeatureIcons features={decodeFeatures(r.f)} max={3} />, csv: (r) => decodeFeatures(r.f).map(featureLabel).join("; ") },
      { key: "results", header: "Results", align: "right", sortValue: (r) => r.results, render: (r) => compact(r.results) },
    );
    return cols;
  }, [db, match]);

  const copy = useCallback(async (list: string[]) => {
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }, []);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const groupList = (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <span className="text-[12px] font-semibold tracking-wide text-text-3 uppercase">Groups</span>
        <Segmented
          options={[
            { value: "count", label: "Count" },
            { value: "volume", label: "Volume" },
          ]}
          value={groupSort}
          onChange={setGroupSort}
        />
      </div>
      <ul className="scroll-thin max-h-[640px] overflow-y-auto px-1.5 pb-2">
        <li>
          <button type="button" onClick={() => setGroup(null)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", group === null ? "bg-brand-soft font-semibold text-brand-ink" : "text-text hover:bg-surface-3")}>
            <span className="flex-1 truncate">All keywords</span>
            <span className="tabular text-[12px]">{filtered.length.toLocaleString()}</span>
          </button>
        </li>
        {groups.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => {
                setGroup(group === g.id ? null : g.id);
                setGroupsOpen(false);
              }}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", group === g.id ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text")}
              title={`${g.count} keywords · ${g.volume.toLocaleString()} total volume`}
            >
              <span className="flex-1 truncate">{g.label}</span>
              <span className="tabular text-[12px] text-text-3">{groupSort === "volume" ? compact(g.volume) : g.count.toLocaleString()}</span>
            </button>
          </li>
        ))}
        {groups.length === 0 && <li className="px-2 py-4 text-center text-[12.5px] text-text-3">No groups for the current filters.</li>}
      </ul>
    </div>
  );

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[228px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-lg border border-border bg-surface pt-3 shadow-card lg:self-start">
        <div className="lg:hidden">
          <button type="button" className="flex w-full items-center justify-between px-3 pb-3 text-[13px] font-medium" onClick={() => setGroupsOpen((o) => !o)} aria-expanded={groupsOpen}>
            <span className="inline-flex items-center gap-1.5">
              <ListFilter className="h-4 w-4 text-text-3" /> Groups {group ? `· ${groups.find((g) => g.id === group)?.label ?? group}` : ""}
            </span>
            <span className="text-text-3">{groupsOpen ? "Hide" : `${groups.length} groups`}</span>
          </button>
          {groupsOpen && groupList}
        </div>
        <div className="hidden lg:block">{groupList}</div>
      </aside>

      <section className="min-w-0 rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3.5 pb-3">
          <FilterMenu label="Volume" summary={rangeSummary(f.volume)} onClear={() => set("volume", emptyRange)}>
            {(close) => <RangePicker value={f.volume} onChange={(v) => set("volume", v)} presets={VOLUME_PRESETS} close={close} />}
          </FilterMenu>
          <FilterMenu label="KD %" summary={rangeSummary(f.kd)} onClear={() => set("kd", emptyRange)}>
            {(close) => (
              <RangePicker
                value={f.kd}
                onChange={(v) => set("kd", v)}
                presets={KD_PRESETS.map((p) => ({ ...p, label: p.label }))}
                close={close}
                unit="0–100"
              />
            )}
          </FilterMenu>
          <FilterMenu label="Intent" summary={f.intents.length ? f.intents.map((i) => INTENT_META[i].label).join(", ") : null} onClear={() => set("intents", [])} width="w-60">
            {() => (
              <ul className="space-y-1">
                {INTENTS.map((i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-[13px] hover:bg-surface-3">
                      <Checkbox checked={f.intents.includes(i)} onChange={() => set("intents", toggle(f.intents, i))} className="mt-0.5" />
                      <span>
                        <span className="font-medium text-text">{INTENT_META[i].label}</span>
                        <span className="block text-[11.5px] text-text-3">{INTENT_META[i].note}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </FilterMenu>
          <FilterMenu label="CPC (USD)" summary={rangeSummary(f.cpc, (n) => `$${n}`)} onClear={() => set("cpc", emptyRange)}>
            {(close) => <RangePicker value={f.cpc} onChange={(v) => set("cpc", v)} presets={CPC_PRESETS} step={0.01} close={close} unit="USD" />}
          </FilterMenu>
          <FilterMenu label="Words" summary={rangeSummary(f.words)} onClear={() => set("words", emptyRange)}>
            {(close) => <RangePicker value={f.words} onChange={(v) => set("words", v)} presets={WORD_PRESETS} close={close} />}
          </FilterMenu>
          <FilterMenu label="SERP features" summary={f.features.length ? `${f.features.length} selected` : null} onClear={() => set("features", [])} width="w-60">
            {() => (
              <ul className="scroll-thin max-h-72 space-y-0.5 overflow-y-auto">
                <li className="px-1 pb-1 text-[11.5px] text-text-3">Keywords whose SERP shows any of:</li>
                {SERP_FEATURES.filter((x) => x.id !== "related_searches").map((x) => (
                  <li key={x.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-surface-3">
                      <Checkbox checked={f.features.includes(x.id)} onChange={() => set("features", toggle(f.features, x.id))} />
                      <span className="text-text-3">
                        <FeatureIcon feature={x.id} />
                      </span>
                      <span className="text-text">{x.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </FilterMenu>
          <FilterMenu label="Include" summary={f.include.trim() ? f.include.trim() : null} onClear={() => set("include", "")} width="w-72">
            {(close) => (
              <div className="space-y-2">
                <Segmented
                  options={[
                    { value: "any", label: "Any of these words" },
                    { value: "all", label: "All words" },
                  ]}
                  value={f.includeMode}
                  onChange={(v) => set("includeMode", v)}
                />
                <Input autoFocus placeholder="e.g. women, trail" value={f.include} onChange={(e) => set("include", e.target.value)} onKeyDown={(e) => e.key === "Enter" && close()} aria-label="Include words" />
                <p className="text-[11.5px] text-text-3">Separate words with spaces or commas. Singular and plural forms match.</p>
              </div>
            )}
          </FilterMenu>
          <FilterMenu label="Exclude" summary={f.exclude.trim() ? f.exclude.trim() : null} onClear={() => set("exclude", "")} width="w-72" align="right">
            {(close) => (
              <div className="space-y-2">
                <Input autoFocus placeholder="e.g. free, cheap" value={f.exclude} onChange={(e) => set("exclude", e.target.value)} onKeyDown={(e) => e.key === "Enter" && close()} aria-label="Exclude words" />
                <p className="text-[11.5px] text-text-3">Hide keywords containing any of these words.</p>
              </div>
            )}
          </FilterMenu>
          {hasAutocomplete && (
            <button
              type="button"
              onClick={() => set("acOnly", !f.acOnly)}
              aria-pressed={f.acOnly}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium",
                f.acOnly ? "border-good/40 bg-good-soft text-good-ink" : "border-border-strong bg-surface text-text-2 hover:bg-surface-3 hover:text-text",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" /> Autocomplete only
            </button>
          )}
          {(activeCount > 0 || group) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setF(EMPTY);
                setGroup(null);
              }}
            >
              Clear all
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-border bg-surface-2 px-4 py-2.5 text-[13px]">
          <span className="text-text-2">
            {group ? (
              <>
                Group <span className="font-semibold text-text">“{groups.find((g) => g.id === group)?.label ?? group}”</span>:{" "}
              </>
            ) : (
              "All keywords: "
            )}
            <span className="tabular font-semibold text-text">{visible.length.toLocaleString()}</span>
            {visible.length !== rows.length && <span className="text-text-3"> of {rows.length.toLocaleString()}</span>}
          </span>
          <span className="text-text-2">
            Total volume: <span className="tabular font-semibold text-text">{totals.vol.toLocaleString()}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-text-2">
            Average KD:{" "}
            {totals.kd == null ? (
              <span className="text-text-3">n/a</span>
            ) : (
              <>
                <span className="tabular font-semibold text-text">{totals.kd}%</span>
                <span className="h-2 w-2 rounded-full" style={{ background: kdBand(totals.kd).color }} aria-hidden />
                <span className="text-text-3">{kdBand(totals.kd).label}</span>
              </>
            )}
          </span>
          {hasAutocomplete && (
            <span className="text-text-2">
              From Autocomplete: <span className="tabular font-semibold text-text">{totals.ac.toLocaleString()}</span>
            </span>
          )}
          {truncated && <span className="text-[12px] text-text-3">Showing the top {rows.length.toLocaleString()} of {total.toLocaleString()} by volume.</span>}
        </div>

        <DataTable
          className="pt-3"
          rows={visible}
          columns={columns}
          rowKey={(r) => r.keyword}
          defaultSort={match === "related" ? { key: "rel", dir: "desc" } : { key: "volume", dir: "desc" }}
          pageSize={50}
          searchable
          searchText={(r) => r.keyword}
          selectable
          exportName={`keyword-magic-tool_${seed.replace(/\s+/g, "-")}_${db}_${match}`}
          selectionActions={(sel, clear) => (
            <>
              <Button size="sm" variant="ghost" onClick={() => copy(sel.map((r) => r.keyword))}>
                <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Plan a Google Ads campaign with these keywords (up to 300)"
                onClick={() => router.push(`/ppc-keyword-tool?import=${encodeURIComponent(sel.slice(0, 300).map((r) => r.keyword).join(","))}&db=${db}&name=${encodeURIComponent(`${seed} – Search`)}`)}
              >
                <Megaphone className="h-3.5 w-3.5" /> PPC
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setDialog(sel.map((r) => r.keyword));
                  clear();
                }}
              >
                <ListPlus className="h-3.5 w-3.5" /> Add to list
              </Button>
            </>
          )}
          emptyText="No keywords match these filters. Try widening the volume or KD range."
        />
      </section>
      <AddToListDialog open={dialog !== null} onClose={() => setDialog(null)} keywords={dialog ?? []} db={db} defaultName={`${seed} ideas`} from="keyword-magic-tool" />
    </div>
  );
}
