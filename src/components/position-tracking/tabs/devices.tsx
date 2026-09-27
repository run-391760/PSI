import { MapPin, Monitor, Smartphone } from "lucide-react";
import { database } from "@/lib/domain";
import { compact, num, pct } from "@/lib/format";
import { devicesReport, type Ctx } from "@/lib/position-tracking/reports";
import type { DayAggregate, Device } from "@/lib/position-tracking/types";
import { Grid } from "@/components/shell/page";
import { TrendChart } from "@/components/charts/trend-chart";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DevicesTable, TrackBothButton } from "../devices-table";
import { Delta } from "../ui";

function DeviceCard({ device, daily, measured }: { device: Device; daily: DayAggregate[]; measured: boolean }) {
  const clicks = daily.reduce((sum, a) => sum + (a.clicks ?? 0), 0);
  const impressions = daily.reduce((sum, a) => sum + (a.impressions ?? 0), 0);
  const s = daily[0];
  const e = daily[daily.length - 1];
  const Icon = device === "mobile" ? Smartphone : Monitor;
  const row = (label: string, value: string, delta: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-[12.5px] text-text-2">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="tabular text-[15px] font-semibold text-text">{value}</span>
        <span className="w-16 text-right">{delta}</span>
      </span>
    </div>
  );
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Icon className="h-4 w-4 text-text-3" /> {device === "mobile" ? "Mobile" : "Desktop"}
          </span>
        }
        description="End of range · change vs start"
      />
      <CardBody>
        {e ? (
          <>
            {row("Visibility", pct(e.visibility, 2), <Delta value={s ? e.visibility - s.visibility : null} digits={2} />)}
            {measured
              ? <>
                  {row("Clicks (range)", compact(clicks), null)}
                  {row("Impressions (range)", compact(impressions), null)}
                </>
              : row("Estimated traffic", compact(e.traffic), <Delta value={s && s.traffic ? ((e.traffic - s.traffic) / s.traffic) * 100 : null} suffix="%" />)}
            {row("Average position", e.avgPosition == null ? "n/a" : num(e.avgPosition, 1), <Delta value={s?.avgPosition != null && e.avgPosition != null ? s.avgPosition - e.avgPosition : null} />)}
            {row("Top 3", String(e.top3), <Delta value={s ? e.top3 - s.top3 : null} digits={0} />)}
            {row("Top 10", String(e.top10), <Delta value={s ? e.top10 - s.top10 : null} digits={0} />)}
            {row(measured ? "With impressions" : "Top 100", String(e.top100), <Delta value={s ? e.top100 - s.top100 : null} digits={0} />)}
          </>
        ) : (
          <p className="py-8 text-center text-[13px] text-text-3">No data for this device yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

export async function DevicesTab({ ctx }: { ctx: Ctx }) {
  const d = await devicesReport(ctx);
  const db = database(ctx.campaign.db);
  const params = new URLSearchParams({ project: ctx.project.id, tab: "overview", range: String(ctx.range) });
  const merged = new Map<string, Record<string, unknown>>();
  for (const dev of ctx.devices)
    for (const a of d.daily[dev] ?? []) {
      const r = merged.get(a.day) ?? { day: a.day };
      r[dev] = Math.round(a.visibility * 100) / 100;
      merged.set(a.day, r);
    }
  const better = d.rows.reduce((acc, r) => ((r.diff ?? 0) > 0 ? { ...acc, mobile: acc.mobile + 1 } : (r.diff ?? 0) < 0 ? { ...acc, desktop: acc.desktop + 1 } : r.diff === 0 ? { ...acc, same: acc.same + 1 } : acc), { mobile: 0, desktop: 0, same: 0 });
  const other: Device = ctx.devices[0] === "desktop" ? "mobile" : "desktop";

  return (
    <>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Location" description="Where rankings are measured" />
          <CardBody className="space-y-2 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">{db.flag}</span>
              <span className="font-medium text-text">{db.name}</span>
              <span className="text-text-3">· Google · {db.language.toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-2 text-text-2">
              <MapPin className="h-4 w-4 text-text-3" /> {ctx.campaign.location || "Country-level results (no city set)"}
            </div>
            <ButtonLink href={`/position-tracking?project=${ctx.project.id}&tab=settings`} size="sm" variant="ghost" className="-ml-2.5">
              Change location →
            </ButtonLink>
          </CardBody>
        </Card>
        {ctx.devices.map((dev) => (
          <DeviceCard key={dev} device={dev} daily={d.daily[dev] ?? []} measured={ctx.measured} />
        ))}
        {!d.both && (
          <Card>
            <CardHeader title={`Compare with ${other}`} />
            <CardBody>
              <p className="mb-3 text-[13px] text-text-2">
                You only track {ctx.devices[0]} results. Rankings often differ by several positions between devices, and mobile is where most searches happen.
              </p>
              <TrackBothButton projectId={ctx.project.id} campaign={{ db: ctx.campaign.db, location: ctx.campaign.location, competitors: ctx.campaign.competitors, device: ctx.campaign.device }} />
            </CardBody>
          </Card>
        )}
      </Grid>

      {d.both && (
        <>
          <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Visibility by device" description={`${ctx.project.domain}, daily`} />
              <CardBody>
                {merged.size > 1 ? (
                  <TrendChart
                    data={[...merged.values()]}
                    xKey="day"
                    xFormat="day"
                    yFormat="percent"
                    series={[
                      { key: "desktop", label: "Desktop" },
                      { key: "mobile", label: "Mobile" },
                    ]}
                    height={250}
                  />
                ) : (
                  <p className="py-12 text-center text-[13px] text-text-3">Not enough history yet.</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Where you rank better" description="Keywords on the end date" />
              <CardBody className="space-y-3">
                {[
                  { label: "Better on mobile", value: better.mobile, icon: Smartphone },
                  { label: "Better on desktop", value: better.desktop, icon: Monitor },
                  { label: "Same position", value: better.same, icon: null },
                ].map((x) => (
                  <div key={x.label} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-3 text-text-3">{x.icon ? <x.icon className="h-4 w-4" /> : "="}</span>
                    <span className="flex-1 text-[13px] text-text-2">{x.label}</span>
                    <span className="tabular text-[18px] font-semibold text-text">{x.value}</span>
                  </div>
                ))}
                <p className="text-[12px] text-text-3">{d.rows.filter((r) => r.desktop == null && r.mobile == null).length} keywords rank on neither device.</p>
              </CardBody>
            </Card>
          </Grid>
          <Card>
            <CardHeader title="Desktop vs mobile positions" description="Your position per keyword on each device" />
            <DevicesTable rows={d.rows} exportName={`devices-${ctx.project.domain}`} kwBase={`/position-tracking?${params.toString()}`} />
          </Card>
        </>
      )}
    </>
  );
}
