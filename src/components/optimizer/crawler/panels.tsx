"use client";

import { ChevronDown, ChevronRight, ExternalLink, History, Play, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createDraftAction } from "@/app/(app)/optimizer/actions";
import { Bar10, color10, fmt10, SeverityBadge, tone10 } from "@/components/optimizer/ui";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { timeAgo } from "@/lib/format";
import { groupFlags, RULES } from "@/lib/optimizer/crawl/rules";
import type { CrawlListItem, Flag, FlagSeverity, PageResult, Skip } from "@/lib/optimizer/crawl/types";
import { cn } from "@/lib/utils";

/** Panels around the live stage: progress, live flags, site map, page details, pages table, past crawls. */

export const SEV_TONE: Record<FlagSeverity, Tone> = { critical: "critical", high: "serious", medium: "warning", low: "neutral" };

export const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
};
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* -------------------------------------------------------------------------------- progress */

export function ProgressPanel({ pages, maxPages, queued, fetching, elapsedMs, timeCapMs, crawlDelayMs, robots, skips, status, stopReason }: { pages: PageResult[]; maxPages: number; queued: number; fetching: string | null; elapsedMs: number; timeCapMs: number; crawlDelayMs: number | null; robots: "found" | "missing" | null; skips: Skip[]; status: string; stopReason: string | null }) {
  const [openSkips, setOpenSkips] = useState(false);
  const done = pages.length;
  const pct = maxPages ? Math.min(100, (done / maxPages) * 100) : 0;
  return (
    <Card>
      <CardHeader title="Crawl progress" description={status === "running" ? "Polite crawl in progress" : stopReason ?? undefined} />
      <CardBody className="space-y-2.5 pt-0">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[18px] font-semibold tabular-nums text-text">
              {done}
              <span className="text-[13px] font-normal text-text-3">/{maxPages}</span>
            </div>
            <div className="text-[11.5px] text-text-3">Pages</div>
          </div>
          <div>
            <div className="text-[18px] font-semibold tabular-nums text-text">{queued}</div>
            <div className="text-[11.5px] text-text-3">In queue</div>
          </div>
          <div>
            <div className="text-[18px] font-semibold tabular-nums text-text">{mmss(elapsedMs)}</div>
            <div className="text-[11.5px] text-text-3">of {mmss(timeCapMs)} max</div>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={maxPages}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        {status === "running" && fetching && (
          <div className="truncate font-mono text-[11.5px] text-text-2" title={fetching}>
            → {fetching.replace(/^https?:\/\//, "")}
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-text-3">
          <span>robots.txt: {robots ?? "n/a"}</span>
          <span>gap per host: {crawlDelayMs != null ? `${(crawlDelayMs / 1000).toFixed(2)} s` : "n/a"}</span>
          <span>depth ≤ 3</span>
          {skips.length > 0 && (
            <button type="button" className="text-link hover:underline" onClick={() => setOpenSkips((v) => !v)}>
              {skips.length} skipped
            </button>
          )}
        </div>
        {openSkips && (
          <ul className="scroll-thin max-h-28 space-y-1 overflow-y-auto text-[11.5px]">
            {skips.map((s, i) => (
              <li key={i} className="truncate text-text-2" title={`${s.url} — ${s.reason}`}>
                <span className="font-mono">{pathOf(s.url)}</span> · <span className="text-text-3">{s.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------------- live flags */

type PageFlag = Flag & { page: number };

export function FlagsPanel({ pages, onPick, className }: { pages: PageResult[]; onPick: (page: number, blockId: string | null) => void; className?: string }) {
  const groups = useMemo(() => groupFlags(pages.flatMap((p) => p.flags.map((f) => ({ ...f, page: p.index }) as PageFlag))), [pages]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader title="Live flags" description={total ? `${total} measured issue${total === 1 ? "" : "s"} · click one to see it on the page` : "Measured issues appear here as the spider finds them"} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const isOpen = open[g.rule] ?? false;
          return (
            <div key={g.rule} className="border-t border-border first:border-t-0">
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.rule]: !isOpen }))}>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-3" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-3" />}
                <SeverityBadge severity={g.severity} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{g.label}</span>
                <span className="text-[12px] font-semibold tabular-nums text-text-2">{g.items.length}</span>
              </button>
              {isOpen && (
                <ul className="mb-1 ml-7 space-y-0.5">
                  {g.items.slice(0, 40).map((f, i) => (
                    <li key={i}>
                      <button type="button" className="block w-full rounded px-1.5 py-1 text-left hover:bg-surface-2" onClick={() => onPick(f.page, f.blockId)} title={RULES[f.rule].fix}>
                        <span className="block truncate font-mono text-[11px] text-text-3">{pathOf(pages[f.page]?.finalUrl ?? "")}</span>
                        <span className="block text-[12px] break-words text-text-2">{f.label}</span>
                      </button>
                    </li>
                  ))}
                  {g.items.length > 40 && <li className="px-1.5 text-[11.5px] text-text-3">+{g.items.length - 40} more in the CSV export</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------------- site map */

const W = 320;
const ROW = 46;
const PER_LINE = 14;

export function SiteMap({ pages, shown, onPick }: { pages: PageResult[]; shown: number | null; onPick: (page: number) => void }) {
  const layout = useMemo(() => {
    const byDepth = new Map<number, PageResult[]>();
    for (const p of pages) byDepth.set(p.depth, [...(byDepth.get(p.depth) ?? []), p]);
    const pos = new Map<number, { x: number; y: number }>();
    let y = 16;
    for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
      const row = byDepth.get(d)!;
      for (let line = 0; line * PER_LINE < row.length; line++) {
        const chunk = row.slice(line * PER_LINE, (line + 1) * PER_LINE);
        chunk.forEach((p, i) => pos.set(p.index, { x: 12 + ((i + 0.5) * (W - 24)) / chunk.length, y }));
        y += line * PER_LINE + PER_LINE < row.length ? 20 : ROW;
      }
    }
    return { pos, height: Math.max(60, y - ROW + 22) };
  }, [pages]);
  const r = pages.length > 12 ? 5 : 7;
  const fill = (p: PageResult) => (p.status == null || p.status >= 400 ? "var(--critical)" : p.score?.score == null ? "var(--border-strong)" : color10(p.score.score));
  return (
    <Card>
      <CardHeader title="Site map" description="Crawled pages by depth, coloured by optimizer score" />
      <CardBody className="pt-0">
        {pages.length ? (
          <svg viewBox={`0 0 ${W} ${layout.height}`} className="w-full" role="img" aria-label={`${pages.length} crawled pages by depth`}>
            {pages.map((p) => {
              const a = p.from != null ? layout.pos.get(p.from) : null;
              const b = layout.pos.get(p.index);
              return a && b ? <line key={`e${p.index}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-strong)" strokeWidth={0.8} /> : null;
            })}
            {pages.map((p) => {
              const c = layout.pos.get(p.index);
              if (!c) return null;
              return (
                <g
                  key={p.index}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer outline-none"
                  onClick={() => onPick(p.index)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(p.index))}
                  aria-label={`${pathOf(p.finalUrl)}: score ${fmt10(p.score?.score)}, ${p.flags.length} flags`}
                >
                  <title>{`${pathOf(p.finalUrl)}\nScore ${fmt10(p.score?.score)}/10 · ${p.flags.length} flags · HTTP ${p.status ?? "error"}`}</title>
                  <circle cx={c.x} cy={c.y} r={r + 4} fill="transparent" />
                  <circle cx={c.x} cy={c.y} r={r} fill={fill(p)} stroke={shown === p.index ? "var(--text)" : "var(--surface)"} strokeWidth={shown === p.index ? 2 : 1} />
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="py-4 text-center text-[12.5px] text-text-3">Pages appear here as they are crawled.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
          {[
            ["8–10", "var(--good)"],
            ["6–8", "var(--warning)"],
            ["4–6", "var(--serious)"],
            ["< 4 / error", "var(--critical)"],
          ].map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------------- optimize */

export function OptimizeButton({ page, domain, size = "sm", variant = "secondary" }: { page: PageResult; domain: string; size?: "sm" | "md"; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = page.status != null && page.status < 300 && !page.error && page.blocks.length > 0;
  return (
    <span className="inline-flex flex-col items-start">
      <Button
        size={size}
        variant={variant}
        loading={busy}
        disabled={!ok}
        title={ok ? "Import this page as a draft in the Pre-Publish Optimizer" : "Only pages that loaded can be optimized"}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const keyword = page.score?.keyword || page.title.split(/\s+[|–—·:-]\s+/)[0]?.toLowerCase().slice(0, 100) || domain;
          const r = await createDraftAction({ keyword, importUrl: page.finalUrl });
          if (!r.ok) {
            setBusy(false);
            return setError(r.error);
          }
          router.push(`/optimizer?doc=${r.data.id}`);
        }}
      >
        {!busy && <Wand2 className="h-3.5 w-3.5" />} Optimize this page
      </Button>
      {error && <span className="mt-1 max-w-[220px] text-[11.5px] text-critical-ink">{error}</span>}
    </span>
  );
}

/* -------------------------------------------------------------------------------- page details */

export function PageDetail({ page, domain, onPick }: { page: PageResult | null; domain: string; onPick: (page: number, blockId: string | null) => void }) {
  if (!page)
    return (
      <Card>
        <CardHeader title="Page details" />
        <CardBody className="pt-0 text-[13px] text-text-3">The page the spider is on (or the one you pick) is explained here.</CardBody>
      </Card>
    );
  const s = page.score;
  const groups = groupFlags(page.flags);
  return (
    <Card>
      <CardHeader
        title={<span className="break-all">{page.title || pathOf(page.finalUrl)}</span>}
        description={
          <a href={page.finalUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-link hover:underline">
            {page.finalUrl} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        }
        actions={<OptimizeButton page={page} domain={domain} />}
      />
      <CardBody className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <Badge tone={page.status != null && page.status < 300 ? "good" : "critical"}>HTTP {page.status ?? "error"}</Badge>
          {page.timing.ttfbMs != null && <Badge tone={page.timing.ttfbMs > 1800 ? "warning" : "neutral"}>TTFB {page.timing.ttfbMs} ms</Badge>}
          {page.timing.totalMs != null && <Badge>Loaded in {page.timing.totalMs} ms</Badge>}
          {page.words != null && <Badge tone={page.words < 250 ? "warning" : "neutral"}>{page.words.toLocaleString()} words</Badge>}
          {page.redirects > 0 && <Badge tone="warning">{page.redirects} redirect{page.redirects === 1 ? "" : "s"}</Badge>}
          <Badge>Depth {page.depth}</Badge>
          <Badge>{page.linksChecked} links checked</Badge>
        </div>
        {page.error && <p className="text-[12.5px] text-critical-ink">{page.error}</p>}
        {s && s.score != null && (
          <div className="rounded-md border border-border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-text">Optimizer score</span>
              <Badge tone={tone10(s.score)}>{fmt10(s.score)}/10</Badge>
            </div>
            <Bar10 value={s.score} className="mt-1.5" />
            <p className="mt-1.5 text-[11.5px] text-text-3">
              58-check engine run on the page as published, scored against “{s.keyword}” (inferred from the URL or headings; no SERP research). Open it in the optimizer to set the real keyword and research the SERP.
            </p>
            {s.top.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {s.top.map((t) => (
                  <li key={t.feature} className="text-[12.5px]">
                    <span className="mr-1.5 inline-block align-middle">
                      <SeverityBadge severity={t.severity} />
                    </span>
                    <span className="font-medium text-text">{t.name}</span> <span className="text-text-2">— {t.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {groups.length > 0 ? (
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Flags on this page</div>
            <ul className="space-y-1">
              {groups.map((g) => (
                <li key={g.rule} className="text-[12.5px]">
                  <div className="flex items-center gap-1.5">
                    <SeverityBadge severity={g.severity} />
                    <span className="text-text">{g.label}</span>
                    <span className="text-text-3">×{g.items.length}</span>
                  </div>
                  <div className="mt-0.5 ml-1 text-[11.5px] text-text-3">{RULES[g.rule].fix}</div>
                  <ul className="mt-0.5 ml-1">
                    {g.items.slice(0, 6).map((f, i) => (
                      <li key={i}>
                        <button type="button" className="text-left text-[12px] break-words text-link hover:underline" onClick={() => onPick(page.index, f.blockId)}>
                          {f.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ) : page.status != null && page.status < 300 && page.score ? (
          <p className="text-[12.5px] text-good-ink">No element-level issues flagged on this page.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------------- pages table */

export function PagesTable({ pages, domain, onPick }: { pages: PageResult[]; domain: string; onPick: (page: number) => void }) {
  const count = (p: PageResult, sev: FlagSeverity) => p.flags.filter((f) => f.severity === sev).length;
  const columns: Column<PageResult>[] = [
    { key: "index", header: "#", align: "right", width: "44px", sortValue: (p) => p.index + 1, render: (p) => <span className="tabular-nums text-text-3">{p.index + 1}</span> },
    {
      key: "url",
      header: "Page",
      sortValue: (p) => p.finalUrl,
      csv: (p) => p.finalUrl,
      render: (p) => (
        <button type="button" className="block max-w-[420px] text-left" onClick={() => onPick(p.index)} title="Show on the stage">
          <span className="block truncate text-[13px] text-link hover:underline">{pathOf(p.finalUrl)}</span>
          {p.title && <span className="block truncate text-[11.5px] text-text-3">{p.title}</span>}
        </button>
      ),
    },
    { key: "title", header: "Title", exportOnly: true, csv: (p) => p.title },
    { key: "status", header: "Status", align: "right", sortValue: (p) => p.status ?? 0, render: (p) => <Badge tone={p.status != null && p.status < 300 ? "good" : p.status != null && p.status < 400 ? "warning" : "critical"}>{p.status ?? "error"}</Badge> },
    { key: "score", header: "Score", align: "right", sortValue: (p) => p.score?.score ?? -1, csv: (p) => p.score?.score ?? "", render: (p) => <Badge tone={tone10(p.score?.score)}>{fmt10(p.score?.score)}</Badge>, info: "Pre-Publish Optimizer engine score out of 10, against the keyword inferred from the URL." },
    {
      key: "flags",
      header: "Flags",
      align: "right",
      sortValue: (p) => p.flags.length,
      csv: (p) => p.flags.length,
      render: (p) => (
        <span className="inline-flex items-center gap-1">
          {count(p, "critical") > 0 && (
            <Badge tone="critical" title="Critical flags">
              {count(p, "critical")} crit.
            </Badge>
          )}
          {count(p, "high") > 0 && (
            <Badge tone="serious" title="High-severity flags">
              {count(p, "high")} high
            </Badge>
          )}
          <span className="tabular-nums text-text-2">{p.flags.length}</span>
        </span>
      ),
    },
    { key: "critical", header: "Critical flags", exportOnly: true, csv: (p) => count(p, "critical") },
    { key: "high", header: "High flags", exportOnly: true, csv: (p) => count(p, "high") },
    { key: "words", header: "Words", align: "right", hideOnMobile: true, sortValue: (p) => p.words ?? -1, csv: (p) => p.words ?? "", render: (p) => <span className="tabular-nums">{p.words?.toLocaleString() ?? "n/a"}</span> },
    { key: "ttfb", header: "TTFB", align: "right", hideOnMobile: true, sortValue: (p) => p.timing.ttfbMs ?? -1, csv: (p) => p.timing.ttfbMs ?? "", render: (p) => <span className="tabular-nums">{p.timing.ttfbMs != null ? `${p.timing.ttfbMs} ms` : "n/a"}</span> },
    { key: "depth", header: "Depth", align: "right", hideOnMobile: true, sortValue: (p) => p.depth },
    { key: "keyword", header: "Scored keyword", exportOnly: true, csv: (p) => p.score?.keyword ?? "" },
    { key: "top", header: "Top optimizer issue", exportOnly: true, csv: (p) => (p.score?.top[0] ? `${p.score.top[0].name}: ${p.score.top[0].text}` : "") },
    { key: "act", header: "", sortable: false, noExport: true, align: "right", render: (p) => <OptimizeButton page={p} domain={domain} /> },
  ];
  return <DataTable rows={pages} columns={columns} rowKey={(p) => String(p.index)} defaultSort={{ key: "index", dir: "asc" }} pageSize={25} searchable searchText={(p) => `${p.finalUrl} ${p.title}`} searchPlaceholder="Filter pages" exportName={`live-crawl-${domain || "site"}-pages`} dense />;
}

/* -------------------------------------------------------------------------------- past crawls */

export function PastCrawls({ crawls, activeId, onOpen, onDelete }: { crawls: CrawlListItem[]; activeId: string | null; onOpen: (id: string) => void; onDelete: (c: CrawlListItem) => void }) {
  return (
    <Card>
      <CardHeader title="Past crawls" description="Your last 20 crawls. Replays use the stored results — no requests are sent to the site." />
      {crawls.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {crawls.map((c) => (
            <li key={c.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2", c.id === activeId && "bg-brand-soft/40")}>
              <History className="h-4 w-4 shrink-0 text-text-3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text">{c.startUrl.replace(/^https?:\/\//, "")}</div>
                <div className="text-[11.5px] text-text-3">
                  {timeAgo(c.createdAt)} · {c.pages} page{c.pages === 1 ? "" : "s"} · {c.flags} flag{c.flags === 1 ? "" : "s"}
                  {c.status === "cancelled" ? " · stopped early" : ""}
                </div>
              </div>
              <Badge tone={tone10(c.avgScore)} title="Average optimizer score">
                {fmt10(c.avgScore)}
              </Badge>
              <Button size="sm" variant="secondary" onClick={() => onOpen(c.id)}>
                <Play className="h-3.5 w-3.5" /> Replay
              </Button>
              <Button size="sm" variant="ghost" aria-label="Delete crawl" onClick={() => onDelete(c)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<History className="h-5 w-5" />} title="No crawls yet" description="Finished crawls are saved here so you can reopen them." />
      )}
    </Card>
  );
}
