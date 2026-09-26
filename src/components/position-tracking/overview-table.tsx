"use client";

import { Download, Tag as TagIcon, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { deleteKeywordsAction, tagKeywordsAction } from "@/app/(app)/position-tracking/actions";
import { downloadCsv } from "@/lib/csv";
import { compact, displayUrl, money, pct } from "@/lib/format";
import type { OverviewRow, TagRef } from "@/lib/position-tracking/types";
import type { Intent } from "@/lib/seo/types";
import { IntentBadges, PositionChange, SerpFeatureIcons } from "@/components/seo/badges";
import { Button, buttonClass } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { KeywordDrawer } from "./keyword-drawer";
import { Pos, PositionSpark, TagChip, domainColor } from "./ui";

const POSITION_FILTERS = [
  { id: "all", label: "All positions" },
  { id: "top3", label: "Top 3" },
  { id: "top10", label: "Top 10" },
  { id: "top20", label: "Top 20" },
  { id: "top100", label: "Top 100" },
  { id: "none", label: "Not in top 100" },
];
const CHANGE_FILTERS = [
  { id: "all", label: "All changes" },
  { id: "improved", label: "Improved" },
  { id: "declined", label: "Declined" },
  { id: "unchanged", label: "Unchanged" },
  { id: "new", label: "New in top 100" },
  { id: "lost", label: "Lost from top 100" },
];

export function OverviewTable({
  rows,
  projectId,
  domain,
  competitors,
  tags,
  device,
  range,
  db,
  startDay,
  endDay,
  initialKeyword,
  initialFilter,
}: {
  rows: OverviewRow[];
  projectId: string;
  domain: string;
  competitors: string[];
  tags: TagRef[];
  device: string;
  range: number;
  db: string;
  startDay: string | null;
  endDay: string | null;
  initialKeyword: string | null;
  initialFilter: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [posFilter, setPosFilter] = useState("all");
  const [changeFilter, setChangeFilter] = useState(CHANGE_FILTERS.some((f) => f.id === initialFilter) ? initialFilter! : "all");
  const [intent, setIntent] = useState<"all" | Intent>("all");
  const [openId, setOpenId] = useState<string | null>(initialKeyword);
  const [tagDialog, setTagDialog] = useState<{ ids: string[]; mode: "add" | "remove"; clear: () => void } | null>(null);
  const [tagName, setTagName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const domains = useMemo(() => [domain, ...competitors], [domain, competitors]);
  const openRow = rows.find((r) => r.id === openId) ?? null;

  const setKwParam = useCallback(
    (id: string | null) => {
      setOpenId(id);
      const params = new URLSearchParams(search.toString());
      if (id) params.set("kw", id);
      else params.delete("kw");
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [pathname, search],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const p = r.end;
        if (posFilter === "top3" && !(p != null && p <= 3)) return false;
        if (posFilter === "top10" && !(p != null && p <= 10)) return false;
        if (posFilter === "top20" && !(p != null && p <= 20)) return false;
        if (posFilter === "top100" && p == null) return false;
        if (posFilter === "none" && p != null) return false;
        if (changeFilter === "improved" && !((r.change ?? 0) > 0 || (r.start == null && r.end != null))) return false;
        if (changeFilter === "declined" && !((r.change ?? 0) < 0 || (r.start != null && r.end == null))) return false;
        if (changeFilter === "unchanged" && r.change !== 0) return false;
        if (changeFilter === "new" && !(r.start == null && r.end != null)) return false;
        if (changeFilter === "lost" && !(r.start != null && r.end == null)) return false;
        if (intent !== "all" && !r.intents.includes(intent)) return false;
        return true;
      }),
    [rows, posFilter, changeFilter, intent],
  );

  const columns: Column<OverviewRow>[] = useMemo(() => {
    const cols: Column<OverviewRow>[] = [
      {
        key: "keyword",
        header: "Keyword",
        width: "260px",
        sortValue: (r) => r.keyword,
        render: (r) => (
          <div className="min-w-[180px]">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setKwParam(r.id)} className="truncate text-left text-link hover:underline" title="Open keyword details">
                {r.keyword}
              </button>
              <IntentBadges intents={r.intents} />
            </div>
            {r.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {r.tags.slice(0, 3).map((t) => (
                  <TagChip key={t.id} name={t.name} />
                ))}
                {r.tags.length > 3 && <span className="text-[11px] text-text-3">+{r.tags.length - 3}</span>}
              </div>
            )}
          </div>
        ),
        csv: (r) => r.keyword,
      },
      { key: "start", header: "Start", align: "right", info: startDay ? `Position on ${startDay}` : undefined, sortValue: (r) => r.start, render: (r) => <Pos value={r.start} /> },
      { key: "end", header: "End", align: "right", info: endDay ? `Position on ${endDay}` : undefined, sortValue: (r) => r.end, render: (r) => <Pos value={r.end} strong /> },
      {
        key: "change",
        header: "Diff",
        align: "right",
        sortValue: (r) => (r.change != null ? r.change : r.start == null && r.end != null ? 100 : r.start != null && r.end == null ? -100 : null),
        render: (r) => <PositionChange previous={r.start} current={r.end} />,
        csv: (r) => r.change,
      },
      { key: "spark", header: "Trend", sortable: false, noExport: true, render: (r) => <PositionSpark values={r.spark} /> },
      { key: "visibility", header: "Visibility", align: "right", info: "CTR at the current position relative to #1.", sortValue: (r) => r.visibility, render: (r) => pct(r.visibility, 1), csv: (r) => r.visibility.toFixed(2) },
      { key: "features", header: "SERP features", sortable: false, render: (r) => <SerpFeatureIcons features={r.features} owned={r.owned} max={4} />, csv: (r) => r.features.join("; ") },
      { key: "volume", header: "Volume", align: "right", sortValue: (r) => r.volume, render: (r) => (r.volume == null ? <span className="text-text-3">n/a</span> : compact(r.volume)) },
      { key: "cpc", header: "CPC", align: "right", sortValue: (r) => r.cpc, render: (r) => (r.cpc == null ? <span className="text-text-3">n/a</span> : money(r.cpc)) },
      { key: "traffic", header: "Traffic", align: "right", info: "Estimated monthly visits: volume × CTR at the current position.", sortValue: (r) => r.traffic, render: (r) => (r.traffic == null ? <span className="text-text-3">n/a</span> : compact(r.traffic)) },
      {
        key: "url",
        header: "URL",
        sortValue: (r) => r.url,
        render: (r) =>
          r.url ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-[220px] truncate text-link hover:underline" title={r.url}>
              {displayUrl(r.url).replace(/^www\./, "")}
            </a>
          ) : (
            <span className="text-text-3">–</span>
          ),
      },
    ];
    competitors.forEach((c, i) =>
      cols.push({
        key: `c:${c}`,
        header: (
          <span className="inline-flex max-w-[120px] items-center gap-1.5" title={c}>
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: domainColor(i + 1) }} aria-hidden />
            <span className="truncate">{c}</span>
          </span>
        ),
        csvHeader: c,
        align: "right",
        sortValue: (r) => r.competitors[c]?.end ?? null,
        render: (r) => (
          <span className="inline-flex items-center justify-end gap-1.5">
            <Pos value={r.competitors[c]?.end} />
            <span className="w-7 text-left">
              <PositionChange previous={r.competitors[c]?.start} current={r.competitors[c]?.end} compact />
            </span>
          </span>
        ),
        csv: (r) => r.competitors[c]?.end ?? null,
      }),
    );
    return cols;
  }, [competitors, setKwParam, startDay, endDay]);

  const applyTag = () =>
    start(async () => {
      if (!tagDialog) return;
      setError(null);
      const existing = tags.find((t) => t.name.toLowerCase() === tagName.trim().toLowerCase());
      const res = await tagKeywordsAction(projectId, tagDialog.ids, existing ? { id: existing.id } : { name: tagName }, tagDialog.mode);
      if (!res.ok) return setError(res.error);
      tagDialog.clear();
      setTagDialog(null);
      setTagName("");
      router.refresh();
    });

  const exportCsv = () =>
    downloadCsv(`position-tracking-${domain}-${endDay ?? ""}`, [
      ["Keyword", "Tags", "Intent", `Position ${startDay ?? "start"}`, `Position ${endDay ?? "end"}`, "Change", "Best", "Visibility %", "Volume", "CPC", "KD", "Est. traffic", "URL", "SERP features", "Owned features", ...competitors],
      ...filtered.map((r) => [
        r.keyword,
        r.tags.map((t) => t.name).join("; "),
        r.intents.join("; "),
        r.start,
        r.end,
        r.change,
        r.best,
        r.visibility.toFixed(2),
        r.volume,
        r.cpc,
        r.kd,
        r.traffic,
        r.url,
        r.features.join("; "),
        r.owned.join("; "),
        ...competitors.map((c) => r.competitors[c]?.end ?? null),
      ]),
    ]);

  const counts = useMemo(() => {
    const improved = rows.filter((r) => (r.change ?? 0) > 0 || (r.start == null && r.end != null)).length;
    const declined = rows.filter((r) => (r.change ?? 0) < 0 || (r.start != null && r.end == null)).length;
    return { improved, declined, top10: rows.filter((r) => r.end != null && r.end <= 10).length };
  }, [rows]);

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 px-4 text-[12.5px] text-text-2">
        <span>
          <span className="font-semibold text-text">{rows.length}</span> keywords
        </span>
        <span className="text-text-3">·</span>
        <button type="button" className="hover:text-text" onClick={() => setChangeFilter("improved")}>
          <span className="font-semibold text-good-ink">{counts.improved}</span> improved
        </button>
        <span className="text-text-3">·</span>
        <button type="button" className="hover:text-text" onClick={() => setChangeFilter("declined")}>
          <span className="font-semibold text-critical-ink">{counts.declined}</span> declined
        </button>
        <span className="text-text-3">·</span>
        <button type="button" className="hover:text-text" onClick={() => setPosFilter("top10")}>
          <span className="font-semibold text-text">{counts.top10}</span> in top 10
        </button>
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "volume", dir: "desc" }}
        searchable
        searchText={(r) => `${r.keyword} ${r.url ?? ""} ${r.tags.map((t) => t.name).join(" ")}`}
        selectable
        pageSize={50}
        emptyText="No keywords match the current filters."
        toolbar={
          <>
            <Select value={posFilter} onChange={(e) => setPosFilter(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Position filter">
              {POSITION_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Select value={changeFilter} onChange={(e) => setChangeFilter(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Change filter">
              {CHANGE_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
            <Select value={intent} onChange={(e) => setIntent(e.target.value as "all" | Intent)} className="h-8 w-auto text-[12.5px]" aria-label="Intent filter">
              <option value="all">All intents</option>
              <option value="informational">Informational</option>
              <option value="navigational">Navigational</option>
              <option value="commercial">Commercial</option>
              <option value="transactional">Transactional</option>
            </Select>
            <Button size="sm" onClick={exportCsv} title="Export the filtered keywords as CSV">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            {(posFilter !== "all" || changeFilter !== "all" || intent !== "all") && (
              <Button size="sm" variant="ghost" onClick={() => (setPosFilter("all"), setChangeFilter("all"), setIntent("all"))}>
                Reset filters
              </Button>
            )}
          </>
        }
        selectionActions={(selected, clear) => (
          <>
            <Menu
              align="right"
              trigger={() => (
                <button type="button" className={buttonClass("secondary", "sm")}>
                  <TagIcon className="h-3.5 w-3.5" /> Tags
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem onClick={() => (close(), setTagDialog({ ids: selected.map((s) => s.id), mode: "add", clear }))}>Add tag…</MenuItem>
                  <MenuItem onClick={() => (close(), setTagDialog({ ids: selected.map((s) => s.id), mode: "remove", clear }))}>Remove tag…</MenuItem>
                </>
              )}
            </Menu>
            <Button
              size="sm"
              variant="ghost"
              className="text-critical-ink"
              loading={pending}
              onClick={() => {
                if (!confirm(`Stop tracking ${selected.length} keyword${selected.length === 1 ? "" : "s"}? Their history will be deleted.`)) return;
                start(async () => {
                  const res = await deleteKeywordsAction(projectId, selected.map((s) => s.id));
                  if (!res.ok) return setError(res.error);
                  clear();
                  router.refresh();
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </>
        )}
      />
      {error && !tagDialog && (
        <Callout tone="critical" className="m-4">
          {error}
        </Callout>
      )}
      <Dialog
        open={Boolean(tagDialog)}
        onClose={() => (setTagDialog(null), setError(null))}
        size="sm"
        title={tagDialog?.mode === "remove" ? "Remove tag" : "Add tag"}
        description={`${tagDialog?.ids.length ?? 0} keyword${tagDialog?.ids.length === 1 ? "" : "s"} selected`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={!tagName.trim() || (tagDialog?.mode === "remove" && !tags.some((t) => t.name.toLowerCase() === tagName.trim().toLowerCase()))} onClick={applyTag}>
              {tagDialog?.mode === "remove" ? "Remove" : "Apply"}
            </Button>
          </>
        }
      >
        {error && (
          <Callout tone="critical" className="mb-3">
            {error}
          </Callout>
        )}
        <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder={tagDialog?.mode === "remove" ? "Tag to remove" : "Existing or new tag"} list="pt-bulk-tags" maxLength={40} autoFocus aria-label="Tag name" />
        <datalist id="pt-bulk-tags">
          {tags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button key={t.id} type="button" onClick={() => setTagName(t.name)} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-text-2 hover:border-brand hover:text-text">
                {t.name}
              </button>
            ))}
          </div>
        )}
      </Dialog>
      <KeywordDrawer row={openRow} onClose={() => setKwParam(null)} projectId={projectId} domain={domain} domains={domains} device={device} range={range} db={db} allTags={tags} />
    </>
  );
}
