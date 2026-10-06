"use client";

import { Download, Square, Bug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt10, tone10 } from "@/components/optimizer/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Callout } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { Segmented } from "@/components/ui/tabs";
import { downloadCsv } from "@/lib/csv";
import { RULES } from "@/lib/optimizer/crawl/rules";
import { DEFAULT_PAGES, PAGE_LIMITS, timeCapFor } from "@/lib/optimizer/crawl/scope";
import { sseParser } from "@/lib/optimizer/crawl/sse";
import type { CrawlEvent, CrawlListItem, CrawlRecord, CrawlSummary, PageResult, Skip } from "@/lib/optimizer/crawl/types";
import { FlagsPanel, PageDetail, PagesTable, PastCrawls, pathOf, ProgressPanel, SiteMap } from "./panels";
import { CrawlStage, type StageHandle } from "./stage";

/**
 * Live crawler workspace: URL + page limit + Start/Stop, the spider stage, live flags, progress and
 * site map, then the page table and past crawls. Server events are folded into a mutable store and
 * flushed to React a few times per second; the stage receives every event immediately.
 */

type Status = "idle" | "running" | "done" | "cancelled" | "failed";
type Store = {
  id: string | null;
  startUrl: string;
  domain: string;
  maxPages: number;
  crawlDelayMs: number | null;
  robots: "found" | "missing" | null;
  startedAt: number | null;
  finishedAt: number | null;
  timeCapMs: number;
  pages: PageResult[];
  skips: Skip[];
  queued: number;
  fetching: string | null;
  summary: CrawlSummary | null;
  status: Status;
  error: string | null;
  replay: boolean;
};
/** Smooth scrolling, unless the viewer asked for reduced motion. */
const scrollBehavior = (): ScrollBehavior => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
const empty = (maxPages = DEFAULT_PAGES): Store => ({ id: null, startUrl: "", domain: "", maxPages, crawlDelayMs: null, robots: null, startedAt: null, finishedAt: null, timeCapMs: timeCapFor(maxPages), pages: [], skips: [], queued: 0, fetching: null, summary: null, status: "idle", error: null, replay: false });

export function CrawlerWorkspace({ crawls, openId }: { crawls: CrawlListItem[]; openId: string | null }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const stage = useRef<StageHandle>(null);
  const store = useRef<Store>(empty());
  const abort = useRef<AbortController | null>(null);
  const [version, setVersion] = useState(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePoll = useRef(0);
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState<string>(String(DEFAULT_PAGES));
  const [formError, setFormError] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const flush = useCallback((immediate = false) => {
    if (immediate) {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      setVersion((v) => v + 1);
      return;
    }
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      setVersion((v) => v + 1);
    }, 250);
  }, []);

  const st = store.current;
  // A fresh array per flush so memoized panels recompute (page objects are updated in place).
  const pages = useMemo(() => [...store.current.pages], [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = st.status === "running";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(
    () => () => {
      abort.current?.abort();
      savePoll.current++;
    },
    [],
  );

  /**
   * After Stop the server still finishes the page in hand and saves what was crawled, which takes a
   * few seconds: refresh "Past crawls" once the crawl is listed (gives up after about 30 s).
   */
  const refreshWhenSaved = useCallback(
    async (id: string) => {
      const run = ++savePoll.current;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (savePoll.current !== run) return;
        const list = await fetch("/api/optimizer/crawl", { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<CrawlListItem[]>) : []))
          .catch(() => [] as CrawlListItem[]);
        if (savePoll.current !== run) return;
        if (Array.isArray(list) && list.some((c) => c.id === id)) return router.refresh();
      }
    },
    [router],
  );

  /* ---------------------------------------------------------------------------- events */

  const handle = useCallback(
    (e: CrawlEvent) => {
      const s = store.current;
      switch (e.type) {
        case "start":
          s.id = e.id;
          s.domain = e.domain;
          s.startUrl = e.startUrl;
          s.maxPages = e.maxPages;
          s.crawlDelayMs = e.crawlDelayMs;
          s.robots = e.robots;
          s.timeCapMs = e.timeCapMs;
          s.queued = 1;
          flush(true);
          break;
        case "queue":
          s.queued = e.queued;
          flush();
          break;
        case "fetching":
          s.fetching = e.url;
          s.queued = Math.max(0, s.queued - 1);
          flush();
          break;
        case "page":
          s.pages[e.page.index] = { ...e.page, touches: [], flags: [], score: null, linksChecked: 0 };
          stage.current?.addPage({ index: e.page.index, url: e.page.finalUrl, status: e.page.status, blocks: e.page.blocks, title: e.page.title, error: e.page.error, ttfbMs: e.page.timing.ttfbMs });
          flush();
          break;
        case "touch":
          s.pages[e.page]?.touches.push(e.touch);
          stage.current?.addTouch(e.page, e.touch);
          break;
        case "flag":
          s.pages[e.page]?.flags.push(e.flag);
          flush();
          break;
        case "score":
          if (s.pages[e.page]) {
            s.pages[e.page].score = e.score;
            s.pages[e.page].linksChecked = e.linksChecked;
          }
          stage.current?.completePage(e.page);
          flush();
          break;
        case "skip":
          s.skips.push(e.skip);
          flush();
          break;
        case "summary":
          s.summary = e.summary;
          flush();
          break;
        case "done":
          s.status = e.status;
          s.finishedAt = Date.now();
          s.fetching = null;
          stage.current?.end();
          flush(true);
          if (e.saved) router.refresh();
          break;
        case "error":
          s.status = "failed";
          s.error = e.message;
          s.finishedAt = Date.now();
          stage.current?.end();
          flush(true);
          break;
      }
    },
    [flush, router],
  );

  const start = async () => {
    if (running) return;
    setFormError(null);
    if (!url.trim()) return setFormError("Enter a website URL.");
    const maxPages = Number(limit);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    store.current = { ...empty(maxPages), status: "running", startUrl: url.trim(), startedAt: Date.now() };
    setShown(null);
    setNow(Date.now());
    stage.current?.reset();
    flush(true);
    try {
      const res = await fetch("/api/optimizer/crawl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim(), maxPages }), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `The crawl could not start (HTTP ${res.status}).`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const parse = sseParser();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const ev of parse(value)) handle(ev);
      }
      if (store.current.status === "running") {
        store.current.status = "failed";
        store.current.error = "The connection closed before the crawl finished.";
        store.current.finishedAt = Date.now();
        stage.current?.end();
        flush(true);
      }
    } catch (e) {
      if (abort.current !== ctrl) return; // superseded by a newer crawl or a replay
      const s = store.current;
      if (ctrl.signal.aborted) {
        s.status = "cancelled";
        s.summary = s.summary ?? null;
      } else {
        s.status = "failed";
        s.error = e instanceof Error ? e.message : "The crawl failed.";
      }
      s.finishedAt = Date.now();
      s.fetching = null;
      stage.current?.end();
      flush(true);
      // The server saves the pages crawled so far; refresh the list once it has.
      if (ctrl.signal.aborted && s.pages.length && s.id) void refreshWhenSaved(s.id);
    }
  };

  const stop = () => abort.current?.abort();

  /* ---------------------------------------------------------------------------- replay */

  const replay = useCallback(
    async (id: string) => {
      abort.current?.abort();
      abort.current = null;
      setFormError(null);
      let rec: CrawlRecord;
      try {
        const res = await fetch(`/api/optimizer/crawl?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const j = (await res.json()) as CrawlRecord & { error?: string };
        if (!res.ok) throw new Error(j.error ?? "Could not load that crawl.");
        rec = j;
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Could not load that crawl.");
        return;
      }
      store.current = {
        ...empty(rec.maxPages),
        id: rec.id,
        startUrl: rec.startUrl,
        domain: rec.domain,
        pages: rec.pages,
        skips: rec.skips,
        summary: rec.summary,
        status: rec.status === "running" ? "cancelled" : rec.status,
        startedAt: new Date(rec.createdAt).getTime(),
        finishedAt: rec.finishedAt ? new Date(rec.finishedAt).getTime() : null,
        replay: true,
      };
      setUrl(rec.startUrl);
      setShown(null);
      const sg = stage.current;
      if (sg) {
        sg.reset();
        sg.resume("replay");
        for (const p of rec.pages) {
          sg.addPage({ index: p.index, url: p.finalUrl, status: p.status, blocks: p.blocks, title: p.title, error: p.error, ttfbMs: p.timing.ttfbMs });
          for (const t of p.touches) sg.addTouch(p.index, t);
          sg.completePage(p.index);
        }
        sg.end();
      }
      flush(true);
      document.getElementById("crawler-stage")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    },
    [flush],
  );

  const opened = useRef(false);
  useEffect(() => {
    if (openId && !opened.current) {
      opened.current = true;
      void replay(openId);
    }
  }, [openId, replay]);

  const remove = async (c: CrawlListItem) => {
    if (!(await confirm({ title: "Delete this crawl?", description: `The stored results of ${c.startUrl} are deleted. This cannot be undone.`, confirmLabel: "Delete crawl" }))) return;
    await fetch(`/api/optimizer/crawl?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    router.refresh();
  };

  const pick = (page: number, blockId: string | null = null) => {
    stage.current?.pin(page, blockId);
    setShown(page);
    const el = document.getElementById("crawler-stage");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  };

  const exportFlags = () => {
    const rows: (string | number)[][] = [["Page", "HTTP status", "Optimizer score", "Severity", "Issue", "Detail", "How to fix"]];
    for (const p of st.pages) for (const f of p.flags) rows.push([p.finalUrl, p.status ?? "", p.score?.score ?? "", f.severity, RULES[f.rule].label, f.label, RULES[f.rule].fix]);
    downloadCsv(`live-crawl-${st.domain || "site"}-flags`, rows);
  };

  const elapsed = st.startedAt ? (st.finishedAt ?? now) - st.startedAt : 0;
  const shownPage = shown != null ? (pages[shown] ?? null) : null;
  const sum = st.summary;
  const total = running ? st.maxPages : pages.length;

  return (
    <>
      <Card className="mb-4">
        <CardBody>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <label htmlFor="crawl-url" className="sr-only">
              Website URL
            </label>
            <Input id="crawl-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com or https://example.com/blog/" className="min-w-0 flex-1" disabled={running} inputMode="url" autoComplete="url" />
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-text-2">Pages</span>
              <Segmented value={limit} onChange={setLimit} options={PAGE_LIMITS.map((n) => ({ value: String(n), label: String(n) }))} />
              {running ? (
                <Button type="button" variant="danger" onClick={stop} className="ml-auto sm:ml-0">
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
              ) : (
                <Button type="submit" variant="primary" className="ml-auto sm:ml-0">
                  <Bug className="h-4 w-4" /> Start crawl
                </Button>
              )}
            </div>
          </form>
          <p className="mt-2 text-[12px] text-text-3">
            SynapseSEOBot fetches pages of the same domain only, obeys robots.txt and Crawl-delay, sends one request at a time per host, goes 3 levels deep and checks up to 15 links per page (HEAD, then GET). Pages that need JavaScript to render show only their server HTML.
          </p>
          {formError && <p className="mt-2 text-[12.5px] text-critical-ink">{formError}</p>}
        </CardBody>
      </Card>

      {st.status === "failed" && st.error && (
        <Callout tone="critical" className="mb-4" title="The crawl stopped">
          {st.error}
        </Callout>
      )}
      {st.replay && (
        <Callout tone="info" className="mb-4" title={`Replay of ${st.startUrl.replace(/^https?:\/\//, "")}`}>
          Stored results from {st.startedAt ? new Date(st.startedAt).toLocaleString() : "an earlier crawl"}; nothing is fetched from the site. Start a new crawl for fresh data.
        </Callout>
      )}

      <div id="crawler-stage" className="grid scroll-mt-4 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CrawlStage ref={stage} total={total} running={running} replaying={st.replay} onShownChange={setShown} />
        <div className="flex min-w-0 flex-col gap-4 lg:h-[600px]">
          <ProgressPanel pages={pages} maxPages={st.maxPages} queued={st.queued} fetching={st.fetching} elapsedMs={elapsed} timeCapMs={st.timeCapMs} crawlDelayMs={st.crawlDelayMs} robots={st.robots} skips={st.skips} status={st.status} stopReason={sum?.stopReason ?? (st.status === "cancelled" ? "Stopped before finishing" : null)} />
          <FlagsPanel pages={pages} onPick={pick} className="max-h-[420px] lg:max-h-none lg:flex-1" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PageDetail page={shownPage} domain={st.domain} onPick={pick} />
        <SiteMap pages={pages} shown={shown} onPick={(i) => pick(i)} />
      </div>

      {pages.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title={sum ? "Crawl summary" : "Pages so far"}
            description={sum ? `${sum.stopReason ?? "Finished"} · ${Math.round(sum.durationMs / 1000)} s` : "Updates as pages are crawled"}
            actions={
              <Button size="sm" variant="secondary" onClick={exportFlags} disabled={!pages.some((p) => p.flags.length)}>
                <Download className="h-3.5 w-3.5" /> Flags CSV
              </Button>
            }
          />
          {sum && (
            <MetricStrip className="border-y border-border">
              <Metric label="Pages crawled" value={sum.pages} sub={`${sum.ok} OK · ${sum.errors} errors · ${sum.skipped} skipped`} size="sm" />
              <Metric label="Average score" value={<Badge tone={tone10(sum.avgScore)} className="text-[15px]">{fmt10(sum.avgScore)}/10</Badge>} sub="Optimizer engine, averaged over pages" size="sm" />
              <Metric label="Flags" value={sum.flags} sub={`${sum.bySeverity.critical} critical · ${sum.bySeverity.high} high`} size="sm" />
              <Metric label="Most common issue" value={<span className="text-[14px]">{sum.byRule[0]?.label ?? "None"}</span>} sub={sum.byRule[0] ? `${sum.byRule[0].count}× across the site` : undefined} size="sm" />
            </MetricStrip>
          )}
          {sum && sum.worst.length > 0 && (
            <div className="border-b border-border px-4 py-3">
              <div className="mb-1.5 text-[12.5px] font-medium text-text">Fix first</div>
              <ul className="flex flex-wrap gap-2">
                {sum.worst.map((w) => (
                  <li key={w.index}>
                    <button type="button" onClick={() => pick(w.index)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] hover:border-brand">
                      <Badge tone={tone10(w.score)}>{fmt10(w.score)}</Badge>
                      <span className="max-w-[220px] truncate font-mono text-text-2">{pathOf(w.url)}</span>
                      <span className="text-text-3">{w.flags} flags</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <PagesTable pages={pages} domain={st.domain} onPick={(i) => pick(i)} />
        </Card>
      )}

      <div className="mt-4">
        <PastCrawls crawls={crawls} activeId={st.replay ? st.id : null} onOpen={(id) => void replay(id)} onDelete={remove} />
      </div>
      {confirmDialog}
    </>
  );
}
