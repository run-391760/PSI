"use client";

import { ChevronLeft, ChevronRight, Filter, Inbox, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import type { InboxPrefs } from "@/lib/cx/inbox/model";
import { selectedProfileKey, profilePatch, toggleListValue, type CardItem, type Facets } from "@/lib/cx/inbox/stream";
import { MEDIA_TYPES, mediaLabel, parseMediaParam } from "@/lib/cx/ops/model";
import type { ScopeOptions } from "@/lib/cx/ops/scope-model";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BreakIcon, CounterCard, CounterRow, PresenceDot, ProfileIcon, StreamPanel, type MoreConfig, type ViewKind } from "./filter-panel";
import { PrefsProvider, usePrefs } from "./prefs";
import { QueueControls } from "./queue-controls";
import { StreamCard, type CardVariant } from "./stream-card";
import { StreamProvider, useStreamHref, type StreamCtx } from "./stream-ui";

export type QueueUsers = { unassigned: number; agents: { id: string; name: string; status: string; statusName: string; paused: boolean; n: number }[] };

/** Card-stream page body (All Messages, Bookmarks, Queued Tickets): cards + FILTER panel (drawer below lg). */
export function CardStream(props: {
  ctx: StreamCtx; prefs: InboxPrefs; cards: CardItem[]; facets: Facets; variant: CardVariant; scopeOptions: ScopeOptions; more: MoreConfig;
  total: number; page?: number; pageSize?: number; empty: { title: string; description: string; action?: ReactNode };
  users?: QueueUsers; queue?: Parameters<typeof QueueControls>[0]; refreshMs?: number; searchPlaceholder?: string; defaultSort?: string;
}) {
  return (
    <StreamProvider value={props.ctx}>
      <PrefsProvider brand={props.ctx.brand} initial={props.prefs}>
        <CardStreamInner {...props} />
      </PrefsProvider>
    </StreamProvider>
  );
}

function CardStreamInner({ cards, facets, variant, scopeOptions, more, total, page = 1, pageSize, empty, users, queue, refreshMs = 30_000, searchPlaceholder, defaultSort }: Parameters<typeof CardStream>[0]) {
  const router = useRouter();
  const { prefs, setPrefs } = usePrefs();
  const { href, search } = useStreamHref();
  const [drawer, setDrawer] = useState(false);
  const view: ViewKind = prefs.mode === "split" ? prefs.align : "cards";
  const setView = (v: ViewKind) => setPrefs(v === "cards" ? { mode: "cards" } : { mode: "split", align: v });
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, refreshMs);
    return () => clearInterval(t);
  }, [router, refreshMs]);

  const media = parseMediaParam(search.get("media"));
  const pkey = selectedProfileKey({ profile: search.get("profile") ?? undefined, topic: search.get("topic") ?? undefined, channel: search.get("channel") ?? undefined });
  const assignee = search.get("assignee");
  const mediaRows = MEDIA_TYPES.filter((m) => facets.media.some((x) => x.id === m.id && x.n > 0) || media.includes(m.id));
  const counters = (
    <>
      {users && (
        <CounterCard title="Active users" total={users.unassigned + users.agents.reduce((a, x) => a + x.n, 0)} totalParens>
          <CounterRow label="Queue UnAssigned" n={users.unassigned} icon={<PresenceDot status={null} />} active={assignee === "none"} href={href({ assignee: assignee === "none" ? null : "none" })} />
          {users.agents.map((a) => (
            <CounterRow key={a.id} label={a.name} n={a.n} icon={<PresenceDot status={a.status} />} suffix={<BreakIcon status={a.status} paused={a.paused} name={a.statusName} />} active={assignee === a.id} href={href({ assignee: assignee === a.id ? null : a.id })} />
          ))}
        </CounterCard>
      )}
      <CounterCard title="Media type" total={facets.total}>
        {mediaRows.map((m) => <CounterRow key={m.id} label={m.label} n={facets.media.find((x) => x.id === m.id)?.n ?? 0} active={media.includes(m.id)} href={href({ media: toggleListValue(media, m.id) })} />)}
      </CounterCard>
      <CounterCard title="Profile" total={facets.total}>
        {facets.profiles.map((p) => <CounterRow key={p.key} label={p.name} n={p.n} icon={<ProfileIcon network={p.network} />} active={pkey === p.key} href={href(pkey === p.key ? { profile: null, topic: null, channel: null } : profilePatch(p.key))} />)}
      </CounterCard>
    </>
  );
  const panel = (onClose?: () => void) => <StreamPanel scopeOptions={scopeOptions} mediaCounts={facets.media} more={more} defaultSort={defaultSort} view={view} onView={setView} counters={counters} onClose={onClose} className="h-full" />;
  const active = [...media.map((m) => ({ k: `m:${m}`, label: mediaLabel(m), patch: { media: toggleListValue(media, m) } })),
    ...(pkey ? [{ k: "p", label: facets.profiles.find((p) => p.key === pkey)?.name ?? "Profile", patch: { profile: null, topic: null, channel: null } }] : []),
    ...(search.get("q") ? [{ k: "q", label: `“${search.get("q")}”`, patch: { q: null } }] : [])];
  const pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <div className="flex items-start gap-5">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchBox placeholder={searchPlaceholder} />
          {queue && <QueueControls {...queue} />}
          <button type="button" onClick={() => setDrawer(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-2 hover:bg-surface-3 lg:hidden"><Filter className="h-4 w-4" />Filter</button>
        </div>
        {active.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            {active.map((a) => <Link key={a.k} href={href(a.patch)} scroll={false} className="inline-flex items-center gap-1 rounded-full border border-link/40 bg-brand-soft px-2 py-0.5 text-link hover:underline">{a.label}<X className="h-3 w-3" /></Link>)}
            <span className="text-text-3">{num(total)} matching</span>
          </div>
        )}
        {cards.length === 0 ? (
          <div className="rounded-md border border-border bg-surface"><EmptyState icon={<Inbox className="h-5 w-5" />} title={empty.title} description={empty.description} action={empty.action} /></div>
        ) : (
          <ul className={cn("space-y-3", view !== "cards" && "space-y-2")}>
            {cards.map((c) => <StreamCard key={c.key} c={c} variant={variant} align={view === "cards" ? null : view} />)}
          </ul>
        )}
        {pageSize && pages > 1 && (
          <nav className="mt-4 flex items-center justify-between text-[13px]" aria-label="Pages">
            <span className="text-text-3">{num((page - 1) * pageSize + 1)}–{num(Math.min(total, page * pageSize))} of {num(total)}</span>
            <span className="flex gap-1">
              <PageLink disabled={page <= 1} href={href({ page: page > 2 ? String(page - 1) : null })}><ChevronLeft className="h-4 w-4" />Newer</PageLink>
              <PageLink disabled={page >= pages} href={href({ page: String(page + 1) })}>Older<ChevronRight className="h-4 w-4" /></PageLink>
            </span>
          </nav>
        )}
      </div>
      <div className="sticky top-4 hidden max-h-[calc(100dvh-6rem)] w-[300px] shrink-0 lg:flex xl:w-[330px]" data-focus-hide>{panel()}</div>
      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30 lg:hidden" onClick={(e) => e.target === e.currentTarget && setDrawer(false)} role="dialog" aria-label="Filter">
          <div className="h-full w-[340px] max-w-[92vw] overflow-hidden border-l border-border bg-bg p-3 shadow-pop">{panel(() => setDrawer(false))}</div>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled?: boolean; children: ReactNode }) {
  return disabled ? <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-text-3 opacity-50">{children}</span>
    : <Link href={href} className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-text-2 hover:bg-surface-3">{children}</Link>;
}

export function SearchBox({ placeholder = "Search messages, authors, #hashtags", param = "q" }: { placeholder?: string; param?: string }) {
  const { go, search } = useStreamHref();
  const initial = search.get(param) ?? "";
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  return (
    <form className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); go({ [param]: q.trim() || null, t: null }); }} role="search">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-3" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 bg-surface pl-9 text-[13px]" aria-label="Search" />
    </form>
  );
}
