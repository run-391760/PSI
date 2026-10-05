import { ExternalLink, Plug } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { dmy, rangeLabel, SENTIMENT_COLOR, SENTIMENT_LABEL, SENTIMENTS } from "@/lib/cx/reports/model";
import { networkDrillBase, networkView } from "@/lib/cx/reports/social";
import { NETWORKS, type NetworkId } from "@/lib/cx/reports/social-model";
import { mediaLabel } from "@/lib/cx/ops/model";
import { compact, dateLabel, timeAgo } from "@/lib/format";
import { TrendChart } from "@/components/charts/trend-chart";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { DrillTableK, IntervalSelect, LineChartK, PieChartK, PostListK, TileRow, Widget, WordCloudK } from "@/components/cx/reports/kit";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { MiniTable } from "@/components/ui/mini-table";

/**
 * Twitter / Instagram report body (server component, WP-K4). The route pages only pick the network:
 *
 *   export default function Page({ searchParams }) { return <NetworkReport network="twitter" searchParams={searchParams} />; }
 *
 * Mention metrics are stored conversations of the network's media types; owned-profile stats come from the
 * network's API only when it is connected (otherwise a connect card). Never invented numbers.
 */
type SP = Record<string, string | string[] | undefined>;
const na = (v: number | null | undefined) => (v == null ? "n/a" : compact(v));

export async function NetworkReport({ network: NET, searchParams }: { network: NetworkId; searchParams: Promise<SP> }) {
  const net = NETWORKS[NET];
  const title = `${net.label} Report`;
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title={title} />;
  const ctx = await reportContext(brand, sp);
  const v = await networkView(ctx, NET);
  const base = networkDrillBase(ctx, NET);
  const tbase = networkDrillBase(ctx, NET, "tickets");
  const range = rangeLabel(ctx.filters.range);
  const p = v.profile;
  const id = (name: string) => `cx-reports.${net.page}.${name}`;
  const sentSeries = SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], color: SENTIMENT_COLOR[s] }));
  const n = (x: number) => x.toLocaleString("en-US");
  const channelsHref = `/cx/settings/channels?brand=${encodeURIComponent(brand.id)}`;

  const profile = (
    <Widget
      id={id("profile")}
      title={p.stats ? p.stats.name : `Owned ${net.label} profile`}
      info={`Followers and recent posts come from the ${p.catalogue.api} for the ${net.label} account linked to this brand. Nothing is shown until it is connected.`}
      actions={
        <>
          {p.fetchedAt && <Badge>{`${p.catalogue.api} · ${timeAgo(p.fetchedAt)}`}</Badge>}
          {p.stats?.url && (
            <a href={p.stats.url} target="_blank" rel="noreferrer" className="text-text-3 hover:text-text" aria-label="Open profile">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </>
      }
      table={
        p.stats
          ? { columns: ["Recent post", "Date", "Views", "Likes", "Comments", "Shares"], rows: p.stats.recent.map((r) => [r.title || "(no text)", r.at ? r.at.slice(0, 10) : null, r.views, r.likes, r.comments, r.shares]) }
          : undefined
      }
    >
      <div className="grid gap-4">
        {p.state === "live" && p.stats && (
          <>
            {p.stats.handle && <p className="-mt-1 text-[12.5px] text-text-3">{p.stats.handle}</p>}
            <TileRow
              size="md"
              tiles={[
                { key: "followers", label: "Followers", value: na(p.stats.followers) },
                { key: "views", label: NET === "twitter" ? "Impressions" : "Views", value: na(p.stats.views) },
                { key: "posts", label: "Posts", value: na(p.stats.posts) },
                { key: "er", label: "Engagement rate (recent)", value: p.stats.engagementRate == null ? "n/a" : `${p.stats.engagementRate.toFixed(2)}%`, info: "Likes + comments + shares of recent posts divided by their views, over posts that report views." },
              ]}
            />
            {p.history.length >= 2 ? (
              <TrendChart data={p.history} xKey="key" xFormat="day" series={[{ key: "followers", label: "Followers" }]} height={170} yFormat="compact" />
            ) : (
              <p className="text-[12px] text-text-3">Follower history builds from daily snapshots taken when Social analytics or this report loads{p.history[0] ? ` (first snapshot ${dateLabel(p.history[0].key)})` : ""}.</p>
            )}
            {p.stats.recent.length > 0 && (
              <MiniTable
                columns={[{ header: "Recent posts" }, { header: "Views", align: "right" }, { header: "Likes", align: "right" }, { header: "Comments", align: "right" }]}
                rows={p.stats.recent.map((r) => [
                  <span key="t" className="block max-w-[320px] min-w-[140px]">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-link hover:underline">{r.title || "(no text)"}</a>
                    ) : (
                      <span className="line-clamp-1">{r.title || "(no text)"}</span>
                    )}
                    {r.at && <span className="text-[11.5px] text-text-3">{dateLabel(r.at)}</span>}
                  </span>,
                  na(r.views),
                  na(r.likes),
                  na(r.comments),
                ])}
              />
            )}
          </>
        )}
        {p.state === "error" && (
          <Callout tone="critical" title={`The ${p.catalogue.api} returned an error`}>
            {p.error ?? "No data returned."}
          </Callout>
        )}
        {p.state === "connect" && (
          <div className="flex items-start gap-3 text-[13px]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <Plug className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-text">Connect {p.catalogue.name}</h3>
              <p className="mt-1 text-text-2">
                {p.catalogue.api} · {p.catalogue.costNote}.
              </p>
              <p className="mt-1 text-text-3">Shows followers, post count and recent posts&apos; views, likes and comments of your own {net.label} account.</p>
              {p.reason && p.envReady && <p className="mt-1 text-text-3">{p.reason}</p>}
              {p.catalogue.setup && <p className="mt-1 text-text-3">{p.catalogue.setup}</p>}
              {!p.envReady && p.catalogue.env.length > 0 && (
                <p className="mt-2 text-[12px] break-words text-text-3">
                  Server settings:{" "}
                  {p.catalogue.env.map((e) => (
                    <code key={e} className="mx-0.5 rounded bg-surface-3 px-1 py-0.5 text-text-2">{e}</code>
                  ))}
                </p>
              )}
              <ButtonLink href={channelsHref} size="sm" className="mt-3">
                Connect {net.label}
              </ButtonLink>
            </div>
          </div>
        )}
        <div className="border-t border-border pt-3">
          <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-text-2 uppercase">Inbox profiles</div>
          {v.profiles.length ? (
            <DrillTableK
              columns={[{ label: "Profile" }, { label: "Status" }, { label: "Tickets" }]}
              rows={v.profiles.map((c) => {
                const ch = p.inbox.find((x) => x.id === c.id);
                return [
                  { v: c.name },
                  { v: ch?.status === "active" ? (ch.lastSynced ? `Synced ${timeAgo(ch.lastSynced)}` : "Active") : (ch?.status ?? "n/a") },
                  { v: n(c.count), drill: c.count ? { ...tbase, profile: c.id, title: `${c.name} · ${range}` } : null },
                ];
              })}
            />
          ) : (
            <p className="text-[12.5px] text-text-3">
              No {net.label} profile is connected to the inbox. <a href={channelsHref} className="text-link hover:underline">Connect one in Channels</a> to receive {NET === "twitter" ? "mentions and direct messages" : "comments, mentions and messages"} as tickets.
            </p>
          )}
        </div>
      </div>
    </Widget>
  );

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page={net.page}
      title={title}
      source={`Source: stored ${net.label} mentions and tickets`}
      mediaOptions={v.mediaOptions}
      filters={{ scope: true, media: true, basis: true }}
    >
      {v.empty ? (
        <>
          <ReportEmpty brand={brand.id} what={`The ${net.label} report counts stored ${net.label} conversations (${v.media.map(mediaLabel).join(", ")}) by sentiment, with trends, words and top posts.`} />
          {profile}
        </>
      ) : (
        <>
          <Widget
            id={id("tiles")}
            title={`${net.label} conversations`}
            bare
            table={{ columns: ["Metric", "Conversations", "Change %"], rows: (["total", ...SENTIMENTS] as const).map((k) => [k === "total" ? "Total" : SENTIMENT_LABEL[k], v.kpis[k].value, v.kpis[k].change == null ? null : Math.round(v.kpis[k].change! * 100) / 100]) }}
          >
            <TileRow
              tiles={[
                { key: "total", label: "Total", value: n(v.kpis.total.value), change: v.kpis.total.change, badge: net.label, drill: { ...base, title: `${net.label} · ${range}` } },
                ...SENTIMENTS.map((s) => ({
                  key: s,
                  label: SENTIMENT_LABEL[s],
                  value: n(v.kpis[s].value),
                  change: v.kpis[s].change,
                  upIsGood: s !== "negative",
                  seriesKey: s,
                  badge: net.label,
                  drill: { ...base, sentiment: s, title: `${net.label} · ${SENTIMENT_LABEL[s]} · ${range}` },
                })),
              ]}
            />
          </Widget>

          <Widget
            id={id("trend")}
            title={`${net.label} conversations over time`}
            actions={<IntervalSelect value={ctx.filters.interval} />}
            table={{ columns: ["Period", ...SENTIMENTS.map((s) => SENTIMENT_LABEL[s])], rows: v.trend.map((r) => [dmy(String(r.key)), ...SENTIMENTS.map((s) => Number(r[s] ?? 0))]) }}
            insight={{ metric: `${net.label} conversations`, range, rows: v.trend.map((r) => ({ key: String(r.key), value: SENTIMENTS.reduce((t, s) => t + Number(r[s] ?? 0), 0) })), total: v.kpis.total.value, previous: null }}
          >
            <LineChartK data={v.trend} series={sentSeries} drill={{ base, series: "sentiment", x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of conversations" height={280} />
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id={id("sentiment")}
              title="Sentiment"
              table={{ columns: ["Media type", "Positive", "Negative", "Neutral", "Total"], rows: v.byMedia.map((m) => [mediaLabel(m.mediaType), m.positive, m.negative, m.neutral, m.total]) }}
              insight={{ metric: `${net.label} conversations by sentiment`, range, rows: SENTIMENTS.map((s) => ({ key: SENTIMENT_LABEL[s], value: v.sentiment[s] })), total: v.sentiment.total, previous: null }}
            >
              <PieChartK slices={SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], value: v.sentiment[s], color: SENTIMENT_COLOR[s] }))} drill={{ base, series: "sentiment" }} donut centerLabel="conversations" height={250} />
              {v.byMedia.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <DrillTableK
                    columns={[{ label: "Media type" }, ...SENTIMENTS.map((s) => ({ label: SENTIMENT_LABEL[s] })), { label: "Total" }]}
                    rows={v.byMedia.map((m) => [
                      { v: mediaLabel(m.mediaType) },
                      ...SENTIMENTS.map((s) => ({ v: n(m[s]), drill: m[s] ? { ...base, mediaType: m.mediaType, sentiment: s, title: `${mediaLabel(m.mediaType)} · ${SENTIMENT_LABEL[s]}` } : null })),
                      { v: n(m.total), drill: { ...base, mediaType: m.mediaType, title: `${mediaLabel(m.mediaType)} · ${range}` } },
                    ])}
                  />
                </div>
              )}
            </Widget>
            {profile}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id={id("posts")}
              title={`Top ${net.label} posts`}
              info="Most engaged conversations first (where the source reports engagement), then the strongest sentiment, then the newest."
              table={{ columns: ["Date", "Author", "Sentiment", "Text"], rows: v.posts.map((x) => [dmy(x.at), x.author, SENTIMENT_LABEL[x.sentiment], x.title || x.text]) }}
            >
              <PostListK posts={v.posts} drill={base} />
            </Widget>
            <Widget
              id={id("cloud")}
              title="Word Cloud"
              info="Words by the number of conversations that use them. Your topics' own keywords are left out."
              table={{ columns: ["Word", "Conversations"], rows: v.cloud.map((w) => [w.word, w.count]) }}
            >
              <WordCloudK words={v.cloud} drill={{ ...base, titlePrefix: net.label }} />
            </Widget>
          </div>
        </>
      )}
    </ReportFrame>
  );
}
