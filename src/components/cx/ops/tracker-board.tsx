"use client";

import { CheckCheck, EyeOff, ExternalLink, RotateCcw, Ticket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { bulkMentionsAction, createTicketAction } from "@/app/(app)/cx/listening/actions";
import { Ago } from "@/components/cx/inbox/time";
import { SentimentBadge } from "@/components/cx/inbox/ui";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { num, pct } from "@/lib/format";
import { waitLabel, type ResponseState } from "@/lib/cx/ops/model";
import { DEFAULT_FILTERS, filterItems, RANGES, STATE_LABEL, trackerMetrics, type TrackerFilters, type TrackerItem } from "@/lib/cx/ops/tracker-model";

const STATE_TONE: Record<ResponseState, Tone> = { responded: "good", pending: "warning", in_progress: "info", ignored: "neutral" };

export function TrackerBoard({ brand, items, initial, canEdit, empty }: { brand: string; items: TrackerItem[]; initial: Partial<TrackerFilters>; canEdit: boolean; empty: ReactNode }) {
  const router = useRouter();
  const [f, setF] = useState<TrackerFilters>({ ...DEFAULT_FILTERS, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const set = (patch: Partial<TrackerFilters>) => {
    const next = { ...f, ...patch };
    setF(next);
    try {
      const p = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(next)) if (v && v !== (DEFAULT_FILTERS as Record<string, string>)[k]) p.set(k, v); else p.delete(k);
      window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
    } catch {}
  };

  const rows = useMemo(() => filterItems(items, f), [items, f]);
  const m = trackerMetrics(rows);
  const sources = useMemo(() => [...new Map(items.map((i) => [i.source, i.sourceLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const matches = useMemo(() => [...new Map(items.flatMap((i) => i.matched.map((x) => [x.id, x.label] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1])), [items]);

  const run = (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    start(async () => {
      setError(null); setNotice(null);
      try {
        const msg = await fn();
        if (msg) setNotice(msg);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
      setBusy(null);
      router.refresh();
    });
  };
  const mark = (ids: string[], op: "actioned" | "ignored" | "new") => run(`${op}:${ids.join(",")}`, async () => {
    const r = await bulkMentionsAction(brand, ids, op);
    if (!r.ok) throw new Error(r.error);
    return ids.length > 1 ? `${r.data.count} mention${r.data.count === 1 ? "" : "s"} ${op === "new" ? "restored" : `marked ${op}`}.` : null;
  });
  const ticket = (ids: string[]) => run(`ticket:${ids.join(",")}`, async () => {
    let made = 0;
    for (const id of ids.slice(0, 50)) {
      const r = await createTicketAction(brand, id);
      if (!r.ok) throw new Error(made ? `${made} ticket(s) created, then: ${r.error}` : r.error);
      if (!r.data.existing) made++;
    }
    return ids.length > 1 ? `${made} ticket${made === 1 ? "" : "s"} created.` : `Ticket created. Open it from the row.`;
  });

  const ticketHref = (id: string) => `/cx/inbox?brand=${brand}&ticket=${id}`;
  const actionLink = "inline-flex h-6 items-center gap-1 rounded px-1.5 text-[12px] whitespace-nowrap text-link hover:bg-surface-3 disabled:opacity-50";
  const rowActions = (r: TrackerItem) => {
    const b = (op: string) => busy === `${op}:${r.id}` && pending;
    return (
      <div className="-ml-1.5 mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-0.5">
        {r.url && (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className={actionLink}>
            <ExternalLink className="h-3 w-3" /> Original
          </a>
        )}
        {r.ticketId && (
          <Link href={ticketHref(r.ticketId)} className={actionLink}>
            <Ticket className="h-3 w-3" /> Ticket #{r.ticketNumber ?? ""}
          </Link>
        )}
        {canEdit && r.kind === "mention" && r.state === "pending" && (
          <>
            <button type="button" className={actionLink} disabled={pending} onClick={() => ticket([r.id])} title="Create an inbox ticket to reply">
              <Ticket className="h-3 w-3" /> {b("ticket") ? "Creating…" : "Create ticket"}
            </button>
            <button type="button" className={actionLink} disabled={pending} onClick={() => mark([r.id], "actioned")} title="Responded outside the inbox">
              <CheckCheck className="h-3 w-3" /> {b("actioned") ? "Saving…" : "Mark actioned"}
            </button>
            <button type="button" className={actionLink} disabled={pending} onClick={() => mark([r.id], "ignored")}>
              <EyeOff className="h-3 w-3" /> {b("ignored") ? "Saving…" : "Ignore"}
            </button>
          </>
        )}
        {canEdit && r.kind === "mention" && !r.ticketId && (r.state === "ignored" || r.state === "responded") && (
          <button type="button" className={actionLink} disabled={pending} onClick={() => mark([r.id], "new")} title="Move back to pending">
            <RotateCcw className="h-3 w-3" /> {b("new") ? "Saving…" : "Restore"}
          </button>
        )}
      </div>
    );
  };
  const columns: Column<TrackerItem>[] = [
    {
      key: "item", header: "Reply / mention", sortValue: (r) => r.author.toLowerCase(), csv: (r) => r.text,
      render: (r) => (
        <div className="min-w-[180px] max-w-[420px]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px]">
            <span className="truncate font-medium text-text">{r.author}</span>
            {r.handle && r.handle !== r.author && <span className="truncate text-text-3">@{r.handle.replace(/^@/, "")}</span>}
            <span className="text-text-3">·</span>
            <span className="text-text-3">{r.sourceLabel}</span>
            <SentimentBadge sentiment={r.sentiment} />
            <Ago iso={r.publishedAt} className="text-[12px] text-text-3 md:hidden" />
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-text-2">{r.text || <span className="text-text-3">No text</span>}</p>
          {rowActions(r)}
        </div>
      ),
    },
    { key: "author", header: "Author", exportOnly: true, csv: (r) => r.author },
    { key: "source", header: "Source", exportOnly: true, csv: (r) => r.sourceLabel },
    { key: "url", header: "URL", exportOnly: true, csv: (r) => r.url ?? "" },
    { key: "ticket", header: "Ticket", exportOnly: true, csv: (r) => (r.ticketNumber ? `#${r.ticketNumber}` : "") },
    {
      key: "matched", header: "Tracked", hideOnMobile: true, sortValue: (r) => r.matched[0]?.label ?? "", csv: (r) => r.matched.map((x) => x.label).join("; "),
      render: (r) => <div className="flex max-w-[200px] flex-wrap gap-1">{r.matched.slice(0, 3).map((x) => <span key={x.id} className="max-w-full truncate rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-text-2" title={x.label}>{x.label}</span>)}</div>,
    },
    { key: "publishedAt", header: "Posted", align: "right", hideOnMobile: true, sortValue: (r) => r.publishedAt ?? "", csv: (r) => r.publishedAt ?? "", render: (r) => <Ago iso={r.publishedAt} className="whitespace-nowrap text-[12.5px] text-text-2" /> },
    {
      key: "state", header: "Status", sortValue: (r) => r.state, csv: (r) => STATE_LABEL[r.state],
      render: (r) => (
        <div className="whitespace-nowrap">
          <Badge tone={STATE_TONE[r.state]}>{STATE_LABEL[r.state]}</Badge>
          {r.responseMs != null && <div className="mt-0.5 text-[11.5px] text-text-3">in {waitLabel(r.responseMs)}</div>}
        </div>
      ),
    },
    { key: "responseMs", header: "Response time (minutes)", exportOnly: true, sortValue: (r) => r.responseMs ?? -1, csv: (r) => (r.responseMs == null ? "" : Math.round(r.responseMs / 60_000)) },
  ];

  const filtersActive = f.status || f.match || f.source || f.range !== DEFAULT_FILTERS.range;
  return (
    <div className="space-y-4">
      <Card>
        <MetricStrip>
          <Metric label="Tracked items" value={num(m.total)} size="sm" info="Replies and mentions in the selected period that refer to your tracked handles or posts, plus comments and mentions on your own Facebook / Instagram posts." />
          <Metric label="Responded" value={m.respondedPct == null ? "n/a" : pct(m.respondedPct, 0)} sub={`${num(m.responded)} of ${num(m.total - m.ignored)} (excl. ignored)`} size="sm" info="Replied in the inbox, ticket closed, or marked actioned. Ignored items are excluded." />
          <Metric label="Pending" value={num(m.pending)} sub={m.inProgress ? `+ ${num(m.inProgress)} ticket${m.inProgress === 1 ? "" : "s"} in progress` : undefined} size="sm" />
          <Metric label="Median response time" value={m.medianMs == null ? "n/a" : waitLabel(m.medianMs)} size="sm" info="From the time the reply/mention was posted to the first agent reply in its ticket." />
          <Metric label="Ignored" value={num(m.ignored)} size="sm" />
        </MetricStrip>
      </Card>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value })} className="h-8 w-auto text-[13px]" aria-label="Status">
            <option value="">All statuses</option>
            {(Object.keys(STATE_LABEL) as ResponseState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </Select>
          <Select value={f.match} onChange={(e) => set({ match: e.target.value })} className="h-8 w-auto max-w-[220px] text-[13px]" aria-label="Tracked handle or post">
            <option value="">All handles & posts</option>
            {matches.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          <Select value={f.source} onChange={(e) => set({ source: e.target.value })} className="h-8 w-auto text-[13px]" aria-label="Source">
            <option value="">All sources</option>
            {sources.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </Select>
          <Select value={f.range} onChange={(e) => set({ range: e.target.value })} className="h-8 w-auto text-[13px]" aria-label="Date range">
            {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {f.range === "custom" && (
            <span className="flex items-center gap-1.5">
              <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="h-8 w-[140px]" aria-label="From date" />
              <span className="text-text-3">–</span>
              <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="h-8 w-[140px]" aria-label="To date" />
            </span>
          )}
          {filtersActive && <Button size="sm" variant="ghost" onClick={() => set({ ...DEFAULT_FILTERS })}>Reset</Button>}
        </div>
        {error && <Callout tone="critical" className="m-3">{error}</Callout>}
        {notice && <Callout tone="good" className="m-3">{notice}</Callout>}
        {items.length === 0 ? (
          empty
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing matches these filters" description="Widen the date range or clear a filter." />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.key}
            defaultSort={{ key: "publishedAt", dir: "desc" }}
            searchable
            searchPlaceholder="Filter by text or author"
            searchText={(r) => `${r.author} ${r.handle ?? ""} ${r.text}`}
            selectable={canEdit}
            selectionActions={(sel, clear) => {
              const ids = sel.filter((r) => r.kind === "mention" && r.state === "pending").map((r) => r.id);
              if (!ids.length) return <span className="text-[12px] text-text-3">Select pending mentions to act on them</span>;
              return (
                <>
                  <Button size="sm" loading={pending && busy?.startsWith("ticket:")} onClick={() => { ticket(ids); clear(); }}><Ticket className="h-3.5 w-3.5" /> Create {ids.length} ticket{ids.length === 1 ? "" : "s"}</Button>
                  <Button size="sm" loading={pending && busy?.startsWith("actioned:")} onClick={() => { mark(ids, "actioned"); clear(); }}><CheckCheck className="h-3.5 w-3.5" /> Mark actioned</Button>
                  <Button size="sm" loading={pending && busy?.startsWith("ignored:")} onClick={() => { mark(ids, "ignored"); clear(); }}><EyeOff className="h-3.5 w-3.5" /> Ignore</Button>
                </>
              );
            }}
            exportName={`mentions-tracker-${brand}`}
            dense
          />
        )}
      </Card>
    </div>
  );
}
