import { CircleCheck, CircleDashed, LineChart } from "lucide-react";
import Link from "next/link";
import { compact, pct } from "@/lib/format";
import type { ProjectGoogleState } from "@/lib/reports/google-project";
import type { DataSourceRow } from "@/lib/reports/platform";
import { TrendChart } from "@/components/charts/trend-chart";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";

const n = (v: number | null, f: (x: number) => string = compact) => (v == null ? "n/a" : f(v));

/** Project dashboard: real Search Console + GA4 snapshot, or a CTA to link Google. */
export function GoogleSnapshotCard({ state, projectId, domain }: { state: ProjectGoogleState; projectId: string; domain: string }) {
  const href = `/organic-traffic-insights?project=${projectId}`;
  if (state.state !== "ready")
    return (
      <Card>
        <CardHeader title="Search performance" description={`${domain} · Search Console & GA4`} />
        <CardBody>
          {state.state === "error" ? (
            <Callout tone="critical" title="Google data could not be loaded">
              {state.message}
            </Callout>
          ) : (
            <div className="flex flex-col items-center py-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                <LineChart className="h-5 w-5" />
              </span>
              <p className="mt-2 text-[14px] font-semibold text-text">{state.state === "not-configured" ? "Connect Google Search Console & GA4" : state.state === "not-connected" ? "Connect your Google account" : "Link this project's Search Console site and GA4 property"}</p>
              <p className="mt-1 max-w-md text-[12.5px] text-text-2">Real clicks, impressions, average position and top queries from Search Console, plus organic sessions and key events from GA4, for {domain}.</p>
              <ButtonLink href={state.state === "not-configured" ? "/settings?tab=integrations" : href} variant="primary" size="sm" className="mt-3">
                <span className="text-white">{state.state === "not-configured" ? "How to connect" : state.state === "not-connected" ? "Connect Google" : "Link properties"}</span>
              </ButtonLink>
            </div>
          )}
        </CardBody>
      </Card>
    );
  const s = state.snapshot;
  return (
    <Card>
      <CardHeader
        title="Search performance"
        description={`Last ${s.range.days} days · ${s.range.start} → ${s.range.end}`}
        actions={
          <ButtonLink href={href} size="sm" variant="ghost">
            Full report →
          </ButtonLink>
        }
      />
      <div className="flex flex-wrap gap-2 px-4 pb-2">
        {s.clicks != null && <DataSourceBadge source="search-console" fetchedAt={state.fetchedAt} note={state.site ?? undefined} />}
        {s.sessions != null && <DataSourceBadge source="google-analytics" fetchedAt={state.fetchedAt} note={state.property ?? undefined} />}
      </div>
      <MetricStrip className="border-y border-border">
        <Metric label="Clicks" value={n(s.clicks)} delta={s.clicksDelta} size="sm" />
        <Metric label="Impressions" value={n(s.impressions)} delta={s.impressionsDelta} size="sm" />
        <Metric label="Avg. position" value={n(s.position, (x) => x.toFixed(1))} delta={s.positionDelta} upIsGood={false} size="sm" sub={s.ctr != null ? `CTR ${pct(s.ctr * 100, 1)}` : undefined} />
        <Metric label="Organic sessions" value={n(s.sessions)} delta={s.sessionsDelta} size="sm" sub={s.keyEvents != null ? `${compact(s.keyEvents)} key events` : "GA4 not linked"} />
      </MetricStrip>
      <CardBody className="pt-3">
        {s.daily.length > 1 ? (
          <TrendChart
            data={s.daily}
            xKey="date"
            xFormat="day"
            type="line"
            height={190}
            series={[...(s.clicks != null ? [{ key: "clicks", label: "Clicks (Search Console)" }] : []), ...(s.sessions != null ? [{ key: "organic", label: "Organic sessions (GA4)" }] : [])]}
          />
        ) : (
          <p className="py-8 text-center text-[12.5px] text-text-3">No daily data in this period yet.</p>
        )}
        {s.errors.length > 0 && <p className="mt-2 text-[12px] text-critical-ink">{s.errors.join(" · ")}</p>}
      </CardBody>
    </Card>
  );
}

/** Which data providers are connected (Home + project dashboard). */
export function DataSourcesCard({ rows }: { rows: DataSourceRow[] }) {
  return (
    <Card>
      <CardHeader title="Data sources" description="Where the numbers come from" href="/settings?tab=integrations" />
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 px-4 py-2 text-[13px]">
            {r.connected ? <CircleCheck className="h-4 w-4 shrink-0 text-good" aria-label="Connected" /> : <CircleDashed className="h-4 w-4 shrink-0 text-text-3" aria-label="Not connected" />}
            <Link href={r.href} className="min-w-0 flex-1 truncate text-text hover:text-link">
              {r.name}
            </Link>
            <span className={r.connected ? "truncate text-[12px] text-text-2" : "truncate text-[12px] text-text-3"}>{r.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
