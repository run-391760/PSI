import { ExternalLink, Trophy } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { AbDetailActions } from "@/components/cx/ops/ab-actions";
import { OutcomeBadge } from "@/components/cx/ops/ab-table";
import { NoConnectionCallout } from "@/components/cx/ops/ab-ui";
import { CopyButton } from "@/components/cx/publishing/links";
import { LocalTime } from "@/components/cx/publishing/posts-table";
import { ChannelChip, StatusBadge } from "@/components/cx/publishing/shared";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { DistributionBar } from "@/components/ui/progress";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getTest, type VariantDetail } from "@/lib/cx/ops/ab";
import { abStatusTone, resultLabel, statusLabel } from "@/lib/cx/ops/ab-model";
import { requireBrand, type Connection } from "@/lib/cx/publishing/data";
import { AppError } from "@/lib/domain";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "A/B test" };

const NOTICES: Record<string, { tone: "good" | "info" | "warning"; text: string }> = {
  publish: { tone: "good", text: "Test created: both variants were sent to the publisher together. Channels that are not connected are marked “not connected”: post those by hand with the variant's short link, then mark them published in Publishing." },
  schedule: { tone: "good", text: "Test created: both variants are scheduled for the same time." },
  draft: { tone: "info", text: "Test created with both variants saved as drafts in Publishing. Start the test when you are ready." },
  approval: { tone: "warning", text: "This brand requires approval, so both variants were submitted for approval instead of being published. The test runs once both are approved and published (use Start test after approval if they were not scheduled)." },
};

export default async function AbTestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="A/B test" breadcrumbs={[{ label: "CX" }, { label: "A/B testing" }]} redirect="/cx/ab-testing" />;
  const h = await headers();
  const origin = (process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`).replace(/\/$/, "");
  const [d, access] = await Promise.all([
    getTest(brand.id, id, origin).catch((e) => {
      if (e instanceof AppError && e.status === 404) notFound();
      throw e;
    }),
    requireBrand(user.id, brand.id).catch(() => null),
  ]);
  const { test: t, result: r } = d;
  const q = `brand=${brand.id}`;
  const noticeKey = typeof sp.notice === "string" ? sp.notice : "";
  // Draft / approval notices only while the test has not started (the URL keeps ?notice after Start test).
  const notice = (noticeKey === "draft" || noticeKey === "approval") && d.status !== "draft" ? undefined : NOTICES[noticeKey];
  const label = statusLabel(d, t.winner);
  const [va, vb] = d.variants;
  const unconnected = t.channels.filter((k) => !d.connections.find((c) => c.kind === k)?.connected);
  const total = (va.clicks ?? 0) + (vb.clicks ?? 0);
  const conf = Math.round(t.confidence * 100);
  const missing = !va.post || !vb.post;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "A/B testing", href: `/cx/ab-testing?${q}` }, { label: t.name }]}
        title={t.name}
        subject={brand.name}
        description={t.hypothesis || undefined}
        meta={
          <>
            <Badge tone={abStatusTone(d)}>{label}</Badge>
            <OutcomeBadge r={{ status: d.status, winner: t.winner, leader: r.leader, significant: r.significant, clicksA: va.clicks, clicksB: vb.clicks }} />
            <Badge tone="neutral">Real data · tracked-link clicks</Badge>
            <span className="text-[12px] text-text-3">{conf}% confidence · min {t.min_clicks.toLocaleString("en-US")} clicks per variant</span>
          </>
        }
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            <AbDetailActions
              brandId={brand.id}
              id={t.id}
              status={d.status}
              winner={t.winner}
              significant={r.significant}
              leader={r.leader}
              reason={r.reason}
              requireApproval={d.requireApproval}
              canAuthor={!!access?.canAuthor && !missing}
            />
          </>
        }
      />

      <div className="mb-4 grid gap-2 empty:hidden">
        {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
        {missing && <Callout tone="warning" title="A variant post was deleted">The comparison needs both posts and their tracked links. Delete this test and create a new one.</Callout>}
        {d.expired && <Callout tone="warning" title="The test's end date has passed">Clicks after <LocalTime iso={t.ends_at} /> are not counted. Declare the winner or close the test with no winner.</Callout>}
        {d.status !== "completed" && unconnected.length > 0 && <NoConnectionCallout conns={d.connections} brandId={brand.id} kinds={unconnected} />}
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Result"
          info="Both variants go out on the same channels at the same time, so clicks should split 50/50 if they perform equally. The winner rule: each variant needs the minimum clicks, then a two-sided binomial z-test of the split against 50/50 must reach the confidence level."
          description={t.ends_at ? <>Clicks counted until <LocalTime iso={t.ends_at} /></> : "Clicks counted live"}
        />
        <CardBody className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="min-w-0">
            <div className={cn("flex items-start gap-2.5 rounded-lg border p-3", r.significant || t.winner === "a" || t.winner === "b" ? "border-good/30 bg-good-soft" : "border-border bg-surface-2")}>
              <Trophy className={cn("mt-0.5 h-4 w-4 shrink-0", r.significant ? "text-good-ink" : "text-text-3")} />
              <div className="min-w-0 text-[13px]">
                <div className="font-semibold text-text">
                  {t.winner === "a" || t.winner === "b" ? `Variant ${t.winner.toUpperCase()} declared the winner` : t.winner === "none" ? "Closed with no winner" : r.significant ? `Variant ${r.leader!.toUpperCase()} is the winner` : r.leader ? `Variant ${r.leader.toUpperCase()} leads` : total ? "Tied" : "Waiting for clicks"}
                </div>
                <p className="mt-0.5 text-text-2">{r.reason}</p>
                {t.decided_at && <p className="mt-0.5 text-[12px] text-text-3">Decided <LocalTime iso={t.decided_at} /></p>}
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[12.5px] text-text-2">Click split</div>
              {total ? (
                <DistributionBar
                  segments={[
                    { label: "Variant A", value: va.clicks ?? 0, color: "var(--series-1)" },
                    { label: "Variant B", value: vb.clicks ?? 0, color: "var(--series-2)" },
                  ]}
                  format={(v, s) => `${v.toLocaleString("en-US")} · ${s.toFixed(1)}%`}
                />
              ) : (
                <p className="text-[12.5px] text-text-3">No tracked clicks yet. Share or publish the variants; every click on their short links is recorded.</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 [&>*]:bg-surface [&>*]:px-3 [&>*]:py-3">
            <Metric size="sm" label="Clicks A" value={va.clicks == null ? "n/a" : va.clicks.toLocaleString("en-US")} sub={va.clicks != null && va.clicks < t.min_clicks ? `${t.min_clicks - va.clicks} to minimum` : undefined} />
            <Metric size="sm" label="Clicks B" value={vb.clicks == null ? "n/a" : vb.clicks.toLocaleString("en-US")} sub={vb.clicks != null && vb.clicks < t.min_clicks ? `${t.min_clicks - vb.clicks} to minimum` : undefined} />
            <Metric size="sm" label="Lift" info="How many more clicks the leader got than the other variant." value={r.lift == null ? "n/a" : `+${r.lift.toFixed(r.lift < 10 ? 1 : 0)}%`} sub={r.leader ? `${r.leader.toUpperCase()} over ${r.leader === "a" ? "B" : "A"}` : undefined} />
            <Metric size="sm" label="z-score" info="|A − B| / √(A + B); significant when it reaches the threshold for the chosen confidence." value={total ? r.z.toFixed(2) : "n/a"} sub={`needs ${r.zNeeded.toFixed(2)} (${conf}%)`} />
          </div>
        </CardBody>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VariantCard v={va} brandId={brand.id} conns={d.connections} insightsChecked={d.insightsChecked} />
        <VariantCard v={vb} brandId={brand.id} conns={d.connections} insightsChecked={d.insightsChecked} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardHeader title="Daily clicks" description="Tracked-link clicks per variant (UTC days, bots excluded)" />
          <CardBody>
            {d.series.length && total && d.series.length < 4 ? (
              <BarChart data={d.series} xKey="day" xFormat="day" yFormat="number" series={[{ key: "a", label: "Variant A" }, { key: "b", label: "Variant B" }]} height={220} showLegend />
            ) : d.series.length && total ? (
              <TrendChart
                data={d.series}
                xKey="day"
                xFormat="day"
                yFormat="number"
                series={[{ key: "a", label: "Variant A" }, { key: "b", label: "Variant B" }]}
                height={220}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-text-3">The trend appears after the first tracked click.</p>
            )}
          </CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Setup" />
          <CardBody className="grid gap-0.5 text-[12.5px]">
            <Row label="Destination">
              {t.link_url ? (
                <a href={t.link_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-link hover:underline">
                  <span className="truncate">{t.link_url.replace(/^https?:\/\//, "")}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                "n/a"
              )}
            </Row>
            <Row label="Channels">
              <span className="flex flex-wrap justify-end gap-1">{t.channels.map((c) => <ChannelChip key={c} kind={c} />)}</span>
            </Row>
            <Row label="Metric">Tracked-link clicks</Row>
            <Row label="Min clicks / variant">{t.min_clicks.toLocaleString("en-US")}</Row>
            <Row label="Confidence">{conf}%</Row>
            <Row label="Started"><LocalTime iso={d.startedAt} empty={d.status === "draft" ? "Not started" : "n/a"} /></Row>
            <Row label="Ends"><LocalTime iso={t.ends_at} empty="When decided" /></Row>
            <Row label="Created"><LocalTime iso={t.created_at} />{t.created_by_name ? ` · ${t.created_by_name}` : ""}</Row>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 text-right text-text">{children}</span>
    </div>
  );
}

function VariantCard({ v, brandId, conns, insightsChecked }: { v: VariantDetail; brandId: string; conns: Connection[]; insightsChecked: boolean }) {
  const letter = v.variant.toUpperCase();
  const swatch = (
    <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white", v.variant === "a" ? "bg-[var(--series-1)]" : "bg-[var(--series-2)]")}>{letter}</span>
  );
  if (!v.post)
    return (
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2">{swatch} Variant {letter}</span>} />
        <CardBody><p className="text-[13px] text-text-3">The post of this variant was deleted in Publishing; its clicks are no longer attributed.</p></CardBody>
      </Card>
    );
  const p = v.post;
  const unconnected = p.channels.filter((c) => !conns.find((x) => x.kind === c.kind)?.connected).map((c) => c.name);
  const e = v.engagement;
  const eng = (n: number | null | undefined) => (n == null ? "n/a" : n.toLocaleString("en-US"));
  return (
    <Card className="min-w-0">
      <CardHeader
        title={<span className="inline-flex items-center gap-2">{swatch} Variant {letter}</span>}
        description={p.title}
        actions={<StatusBadge status={p.status} />}
      />
      <CardBody className="grid gap-3">
        <div className="scroll-thin max-h-44 overflow-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-text">{p.text || <span className="text-text-3">(empty)</span>}</div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric size="sm" label="Clicks" value={(v.clicks ?? 0).toLocaleString("en-US")} />
          <Metric size="sm" label="Likes" value={eng(e?.likes)} />
          <Metric size="sm" label="Comments" value={eng(e?.comments)} />
          <Metric size="sm" label="Shares" value={eng(e?.shares)} />
        </div>
        {!e && (
          <p className="-mt-1 text-[12px] text-text-3">
            Engagement n/a:{" "}
            {unconnected.length
              ? <>connect {unconnected.join(", ")} in <Link href={`/cx/publishing?brand=${brandId}&tab=settings`} className="text-link hover:underline">Channels &amp; roles</Link> to read likes, comments and shares.</>
              : insightsChecked
                ? "the published post is not among the network's recent items, or the network does not report these metrics."
                : "available once the post is published through a connected network."}
          </p>
        )}

        <div className="min-w-0">
          <div className="mb-1 text-[12.5px] font-medium text-text-2">Channels &amp; tracked links</div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {p.channels.map((c) => {
              const rl = resultLabel(c.result ?? undefined, p.status);
              return (
                <li key={c.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-[12.5px]">
                  <ChannelChip kind={c.kind} withName className="min-w-0" />
                  <span title={c.result?.error ?? undefined}>
                    <Badge tone={rl.tone}>{rl.label}</Badge>
                  </span>
                  {c.result?.url && (
                    <a href={c.result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <span className="ml-auto flex min-w-0 items-center gap-1">
                    {c.short ? (
                      <>
                        <code className="max-w-[170px] truncate rounded bg-surface-3 px-1 text-[11.5px]" title={c.target ?? undefined}>/l/{c.code}</code>
                        <CopyButton text={c.short} />
                      </>
                    ) : (
                      <span className="text-text-3">no link</span>
                    )}
                    <span className="tabular w-12 text-right font-medium text-text">{c.clicks.toLocaleString("en-US")}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {p.channels.some((c) => c.result?.status === "not_connected" || c.result?.status === "failed") && (
            <p className="mt-1 text-[12px] text-text-3">Post it by hand with the short link above, then “mark as published” on the post.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-3">
          <span>
            {p.publishedAt ? <>Published <LocalTime iso={p.publishedAt} /></> : p.scheduledAt ? <>Scheduled <LocalTime iso={p.scheduledAt} /></> : "Not scheduled"}
          </span>
          <Link href={`/cx/publishing/${p.id}?brand=${brandId}`} className="text-link hover:underline">Open in Publishing →</Link>
        </div>
      </CardBody>
    </Card>
  );
}
