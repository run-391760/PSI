"use client";

import { Download, ExternalLink, FileText, Filter, Loader2, Ticket, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { drillExportAction, drillItemsAction } from "@/app/(app)/cx/reports/actions";
import { createTicketFromMentionAction } from "@/app/(app)/cx/ticket/actions";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { downloadBlob } from "@/lib/csv";
import { crmLabel } from "@/lib/cx/inbox/model";
import { mediaLabel } from "@/lib/cx/ops/model";
import type { DrillItem } from "@/lib/cx/reports/drill";
import { dmy, rangeLabel, SENTIMENT_LABEL, drillWindow, type DrillSpec, type Refine, type Sentiment } from "@/lib/cx/reports/model";
import { cn } from "@/lib/utils";
import { NetworkAvatar } from "./avatar";

const SENT_CLS: Record<Sentiment, string> = { positive: "bg-good-soft text-good-ink", negative: "bg-critical-soft text-critical-ink", neutral: "bg-surface-3 text-text-2" };
export const ticketHref = (brand: string, id: string) => `/cx/ticket/${id}?brand=${encodeURIComponent(brand)}`;

/**
 * Drill-down drawer: slides in from the right with the items behind a chart slice. Header: refine filter,
 * CSV/XLSX download, close. Cards open the One Ticket View; a mention that isn't a ticket offers "Create ticket".
 */
export function DrillDrawer({ brand, spec, onClose }: { brand: string; spec: DrillSpec | null; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<DrillItem[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [media, setMedia] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [refine, setRefine] = useState<Refine>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const open = !!spec;

  const load = useCallback(
    async (page: number, f: Refine) => {
      if (!spec) return;
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      const r = await drillItemsAction(brand, spec, page, f);
      if (id !== reqId.current) return;
      setLoading(false);
      if (!r.ok) return setError(r.error);
      setItems((xs) => (page === 1 ? r.data.items : [...xs, ...r.data.items]));
      setTotal(r.data.total);
      setNext(r.data.nextPage);
      if (page === 1 && !f.mediaType && !f.q && !f.sentiment) setMedia(r.data.media);
    },
    [brand, spec],
  );

  // New slice: reset and load page 1.
  useEffect(() => {
    if (!spec) return;
    setItems([]);
    setTotal(0);
    setNext(null);
    setRefine({});
    setQ("");
    setShowFilter(false);
    void load(1, {});
  }, [spec, load]);

  // Escape closes; lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || loading) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void load(next, refine), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading, load, refine]);

  const apply = (f: Refine) => {
    setRefine(f);
    void load(1, f);
  };
  const exportAs = (format: "csv" | "xlsx") =>
    start(async () => {
      if (!spec) return;
      const r = await drillExportAction(brand, spec, format, refine);
      if (!r.ok) return setError(r.error);
      const blob = format === "xlsx" ? new Blob([Uint8Array.from(atob(r.data.data), (c) => c.charCodeAt(0))], { type: r.data.mime }) : new Blob([r.data.data], { type: r.data.mime });
      downloadBlob(r.data.name, blob);
    });
  const openItem = (i: DrillItem) => {
    if (i.href) return router.push(i.href);
    if (i.ticketId) router.push(ticketHref(brand, i.ticketId));
  };
  const createTicket = (i: DrillItem) =>
    start(async () => {
      if (!i.mentionId) return;
      setBusy(i.key);
      const r = await createTicketFromMentionAction(brand, i.mentionId);
      setBusy(null);
      if (!r.ok) return setError(r.error);
      router.push(ticketHref(brand, r.data.id));
    });

  const win = spec ? drillWindow(spec) : null;
  return (
    <div className={cn("fixed inset-0 z-[60]", open ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!open}>
      <div className={cn("absolute inset-0 bg-black/40 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={spec?.title ?? "Details"}
        className={cn(
          "absolute top-0 right-0 flex h-full w-full flex-col border-l border-border bg-surface shadow-modal transition-transform duration-200 ease-out sm:w-[560px]",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {spec && (
          <>
            <header className="flex items-start gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-text">{spec.title}</h2>
                <p className="mt-0.5 text-[12px] text-text-3">
                  {loading && !items.length ? "Loading…" : `${total.toLocaleString("en-US")} item${total === 1 ? "" : "s"}`}
                  {win && ` · ${win.from === win.to ? dmy(win.from) : rangeLabel(win)}`}
                </p>
              </div>
              <button type="button" onClick={() => setShowFilter((s) => !s)} className={cn("rounded-md p-2 text-text-2 hover:bg-surface-3 hover:text-text", showFilter && "bg-surface-3 text-text")} title="Filter within this slice" aria-pressed={showFilter}>
                <Filter className="h-4 w-4" />
                <span className="sr-only">Filter</span>
              </button>
              <Menu
                align="right"
                trigger={() => (
                  <button type="button" className="rounded-md p-2 text-text-2 hover:bg-surface-3 hover:text-text" title="Download">
                    <Download className="h-4 w-4" />
                    <span className="sr-only">Download</span>
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem onClick={() => (close(), exportAs("csv"))}>Download CSV</MenuItem>
                    <MenuItem onClick={() => (close(), exportAs("xlsx"))}>Download XLSX</MenuItem>
                  </>
                )}
              </Menu>
              <button type="button" onClick={onClose} className="rounded-md p-2 text-text-2 hover:bg-surface-3 hover:text-text" title="Close (Esc)">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </header>
            {showFilter && (
              <form
                className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  apply({ ...refine, q });
                }}
              >
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text or author" className="h-8 min-w-40 flex-1 text-[13px]" aria-label="Search within slice" />
                {!spec.sentiment && (
                  <Select value={refine.sentiment ?? ""} onChange={(e) => apply({ ...refine, q, sentiment: e.target.value as Sentiment | "" })} className="h-8 w-32 text-[13px]" aria-label="Sentiment">
                    <option value="">Any sentiment</option>
                    {(["positive", "negative", "neutral"] as const).map((s) => <option key={s} value={s}>{SENTIMENT_LABEL[s]}</option>)}
                  </Select>
                )}
                {media.length > 1 && !spec.mediaType && (
                  <Select value={refine.mediaType ?? ""} onChange={(e) => apply({ ...refine, q, mediaType: e.target.value })} className="h-8 w-40 text-[13px]" aria-label="Media type">
                    <option value="">Any media type</option>
                    {media.map((m) => <option key={m} value={m}>{mediaLabel(m)}</option>)}
                  </Select>
                )}
              </form>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {error && <p className="m-4 rounded-md bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">{error}</p>}
              {!loading && !error && !items.length && <p className="px-4 py-16 text-center text-[13px] text-text-3">No items in this slice.</p>}
              <ul className="divide-y divide-border">
                {items.map((i) => {
                  const actionable = !!(i.ticketId || i.href);
                  return (
                    <li key={i.key}>
                      <div
                        role={actionable ? "link" : undefined}
                        tabIndex={actionable ? 0 : undefined}
                        onClick={() => actionable && openItem(i)}
                        onKeyDown={(e) => actionable && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openItem(i))}
                        className={cn("flex gap-3 px-4 py-3", actionable && "cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none")}
                      >
                        <NetworkAvatar name={i.author} src={i.avatar} network={i.network} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-semibold text-text">{i.author}</span>
                              {i.handle && i.handle !== i.author && <span className="block truncate text-[12px] text-text-3">{i.handle}</span>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {i.sentiment && <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", SENT_CLS[i.sentiment])}>{SENTIMENT_LABEL[i.sentiment]}</span>}
                              {i.ticketId ? (
                                <a href={ticketHref(brand, i.ticketId)} onClick={(e) => e.stopPropagation()} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" title={`Ticket #${i.ticketNumber ?? ""} details`}>
                                  <FileText className="h-3.5 w-3.5" />
                                  <span className="sr-only">Ticket details</span>
                                </a>
                              ) : (
                                <span className="rounded p-1 text-text-3" title="Not a ticket yet">
                                  <FileText className="h-3.5 w-3.5 opacity-50" />
                                </span>
                              )}
                              {i.url ? (
                                <a href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[12.5px] text-link hover:underline" title="Open original">
                                  {dmy(i.at)}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-[12.5px] text-link">{dmy(i.at)}</span>
                              )}
                            </div>
                          </div>
                          {i.title && i.title !== i.text && i.kind !== "ticket" && <p className="mt-1 line-clamp-1 text-[13px] font-medium text-text">{i.title}</p>}
                          <p className="mt-0.5 line-clamp-3 text-[13px] break-words whitespace-pre-line text-text-2">{i.text}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11.5px] text-text-3">{mediaLabel(i.mediaType)}</span>
                            {i.ticketNumber != null && <Badge>Ticket #{i.ticketNumber}</Badge>}
                            {i.badge && i.kind === "ticket" && <Badge tone="info">{crmLabel(i.badge)}</Badge>}
                            {i.badge && i.kind !== "ticket" && <Badge>{i.badge.replace(/_/g, " ")}</Badge>}
                            {!i.ticketId && i.mentionId && (
                              <button
                                type="button"
                                onClick={(e) => (e.stopPropagation(), createTicket(i))}
                                disabled={busy === i.key}
                                className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border-strong bg-surface px-2 text-[12px] font-medium text-text hover:bg-surface-3 disabled:opacity-60"
                              >
                                {busy === i.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />} Create ticket
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {next && (
                <div ref={sentinel} className="flex justify-center py-4">
                  <button type="button" onClick={() => void load(next, refine)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-3">
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load more
                  </button>
                </div>
              )}
              {loading && !items.length && (
                <div className="flex justify-center py-16 text-text-3">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
