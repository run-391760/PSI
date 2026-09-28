import { Columns3, Radio } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { CommandWall, Tile } from "@/components/cx/listening/command-wall";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { SourceIcon } from "@/components/cx/listening/source-icon";
import { Change, TrendingList } from "@/components/cx/listening/viz";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import type { Risk } from "@/lib/cx/listening/crisis-math";
import { delta } from "@/lib/cx/listening/analytics";
import { streamItems, wallData } from "@/lib/cx/listening/command";
import { compact, num, pct, timeAgo } from "@/lib/format";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Command centre" };
export const dynamic = "force-dynamic";

function Big({ label, value, change, upIsGood = true, sub }: { label: string; value: string; change?: number | null; upIsGood?: boolean; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-3">
      <div className="text-[12px] font-medium text-text-2">{label}</div>
      <div className="mt-1 text-[28px] leading-none font-semibold text-text tabular-nums">{value}</div>
      <div className="mt-1.5 text-[12px] text-text-3">{change !== undefined ? <><Change value={change ?? null} upIsGood={upIsGood} /> vs previous 24h</> : sub}</div>
    </div>
  );
}

export default async function CommandPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Command centre" />;
  const [d, live] = await Promise.all([wallData(brand.id), streamItems(brand.id, { id: "live", name: "Live" }, 14)]);
  const nav = (
    <div className="flex gap-2">
      <BrandSwitcher brands={switcher} current={brand.id} />
      <ButtonLink href={`/cx/command/streams?brand=${brand.id}`} variant="secondary"><Columns3 className="h-4 w-4" /> Streams</ButtonLink>
    </div>
  );
  const header = <PageHeader breadcrumbs={[{ label: "CX" }, { label: "Command centre" }]} title="Command centre" subject={brand.name} description="Real-time wall for the war room: live buzz, sentiment, crisis risk, trending issues and the mention stream. Auto-refreshes every minute." actions={nav} />;
  if (!d.topics)
    return (
      <Page>
        {header}
        <Card><EmptyState icon={<Radio className="h-5 w-5" />} title="Add listening topics first" description="The wall shows live mentions, sentiment and crisis signals from your listening topics." action={<ButtonLink variant="primary" href={`/cx/listening/topics?brand=${brand.id}`}>Add a topic</ButtonLink>} /></Card>
      </Page>
    );
  const s = d.cur;
  const sentiment = (["positive", "neutral", "negative"] as const).map((k) => ({ label: SENTIMENT_META[k].label, value: k === "positive" ? s.positive : k === "negative" ? s.negative : s.mentions - s.positive - s.negative, color: SENTIMENT_META[k].color }));
  return (
    <Page wide>
      {header}
      <CommandWall title={`${brand.name} · live`} updatedAt={d.now}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Big label="Mentions (24h)" value={num(s.mentions)} change={delta(s.mentions, d.prev.mentions)} />
          <Big label="Negative (24h)" value={num(s.negative)} change={delta(s.negative, d.prev.negative)} upIsGood={false} />
          <Big label="Net sentiment" value={s.netSentiment == null ? "n/a" : `${s.netSentiment > 0 ? "+" : ""}${Math.round(s.netSentiment)}`} sub={d.prev.netSentiment == null ? "previous 24h n/a" : `previous 24h ${Math.round(d.prev.netSentiment)}`} />
          <Big label="Potential reach" value={s.reach == null ? "n/a" : compact(s.reach)} change={delta(s.reach, d.prev.reach)} />
          <Big label="Open crises" value={num(d.events.length)} sub={d.events[0] ? `latest ${timeAgo(d.events[0].detected_at)}` : "all clear"} />
          <Big label="Open tickets" value={num(d.tickets?.open ?? 0)} sub={`${num(d.tickets?.urgent ?? 0)} high/urgent · ${num(d.tickets?.today ?? 0)} new today`} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
          <Tile title="Mentions per hour · last 24h vs previous 24h">
            <TrendChart data={d.hourly} xKey="label" xFormat="raw" height={220} yFormat="number" showLegend series={[{ key: "mentions", label: "Last 24h" }, { key: "prev_mentions", label: "Previous 24h", dashed: true, color: "var(--chart-text)" }, { key: "negative", label: "Negative", color: "var(--critical)" }]} />
          </Tile>
          <Tile title="Sentiment · 24h">
            {s.mentions ? <DonutChart data={sentiment} centerValue={num(s.mentions)} centerLabel="mentions" legend="bottom" /> : <p className="py-12 text-center text-[13px] text-text-3">No mentions in the last 24 hours.</p>}
          </Tile>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Tile title="Crisis watch" action={<Link href={`/cx/crisis?brand=${brand.id}`} className="text-[12px] text-link">Open</Link>}>
            {d.events.length ? (
              <ul className="grid gap-2">
                {d.events.map((e) => {
                  const r = e.risk as Partial<Risk>;
                  return (
                    <li key={e.id}>
                      <Link href={`/cx/crisis?brand=${brand.id}&event=${e.id}`} className="block rounded-md border border-border p-2 hover:bg-surface-2">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{e.title}</span>
                          {r?.score != null && <Badge tone={r.band === "high" ? "critical" : r.band === "elevated" ? "warning" : "good"}>Risk {r.score}</Badge>}
                        </div>
                        <div className="text-[12px] text-text-3">{e.severity} · {e.status} · {num(e.mentions)} mentions, {num(e.negative)} negative</div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-good-ink">No open crisis events.</p>
            )}
          </Tile>
          <Tile title="Trending issues">
            <div className="-mx-3"><TrendingList issues={d.trending} brandId={brand.id} /></div>
          </Tile>
          <Tile title="Share of voice">
            {d.sov.length ? (
              <ul className="grid gap-2">
                {d.sov.slice(0, 6).map((t, i) => (
                  <li key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(--series-${i + 1})` }} /><span className="truncate text-text">{t.name}</span></span>
                    <span className="text-text-2 tabular-nums">{t.share == null ? "n/a" : pct(t.share * 100)} · {num(t.mentions)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">Add brand and competitor topics.</p>
            )}
          </Tile>
        </div>
        <Tile title="Live stream" className="mt-3" action={<Link href={`/cx/command/streams?brand=${brand.id}`} className="text-[12px] text-link">All streams</Link>}>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {live.map((m) => (
              <li key={m.id} className={cn("min-w-0 rounded-md border-l-4 bg-surface-2 p-2", m.sentiment === "negative" ? "border-l-[var(--critical)]" : m.sentiment === "positive" ? "border-l-[var(--good)]" : "border-l-border-strong")}>
                <div className="flex items-center gap-2 text-[12px] text-text-3">
                  <SourceIcon source={m.source} />
                  <span className="truncate font-medium text-text-2">{m.author}</span>
                  <span className="ml-auto shrink-0">{m.published_at ? timeAgo(m.published_at) : ""}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-text">{m.title || m.body}</p>
              </li>
            ))}
            {!live.length && <li className="py-6 text-center text-[13px] text-text-3">No mentions yet.</li>}
          </ul>
        </Tile>
      </CommandWall>
    </Page>
  );
}
