import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ChannelIcon, channelLabel, NoBrand } from "@/components/cx/inbox/ui";
import { PlanVolume } from "@/components/cx/ops/plan-volume";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { fmtBytes } from "@/lib/cx/ops/model";
import { planUsage } from "@/lib/cx/ops/plan";
import { money, monthLabel, num, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Plan & usage" };

const ROLE_ROWS: [string, string][] = [["admin", "Admins"], ["supervisor", "Supervisors"], ["agent", "Agents"], ["viewer", "Viewers"]];

function delta(cur: number, prev: number) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Plan & usage" }];
  if (!brand) return <NoBrand title="Plan & usage" breadcrumbs={crumbs} redirect="/cx/plan" />;
  const u = await planUsage(brand);
  const q = `?brand=${brand.id}`;
  const cur = u.volume[u.volume.length - 1];
  const prev = u.volume[u.volume.length - 2];
  const connected = u.channels.reduce((s, c) => s + c.active + c.paused + c.error, 0);
  const active = u.channels.reduce((s, c) => s + c.active, 0);
  const totalBytes = u.storage.inboxBytes + u.storage.pubBytes;
  const quotaBytes = u.storage.pubQuotaMb * 1_048_576;
  const isAdmin = brand.role === "owner" || brand.role === "admin";

  return (
    <Page>
      <PageHeader
        title="Plan & usage"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="What this brand actually uses: seats, channels, conversation volume, storage and paid API spend."
        meta={<><Badge tone="neutral">Real usage</Badge><span className="text-[12px] text-text-3">No plan limits are configured in this workspace.</span></>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Seats" value={num(u.seats.total)} sub="incl. owner" size="sm" />
          <Metric label="Channels connected" value={num(connected)} sub={`${num(active)} active`} size="sm" />
          <Metric label={`Tickets · ${monthLabel(cur.month)}`} value={num(cur.tickets)} delta={delta(cur.tickets, prev?.tickets ?? 0)} deltaLabel="vs last month" size="sm" />
          <Metric label={`Messages · ${monthLabel(cur.month)}`} value={num(cur.messagesIn + cur.messagesOut)} sub={`${num(cur.messagesIn)} received · ${num(cur.messagesOut)} sent`} size="sm" />
          <Metric label={`Mentions · ${monthLabel(cur.month)}`} value={num(cur.mentions)} delta={delta(cur.mentions, prev?.mentions ?? 0)} deltaLabel="vs last month" size="sm" />
          <Metric label="Storage used" value={fmtBytes(totalBytes)} sub={`${num(u.storage.inboxFiles + u.storage.pubFiles)} files`} size="sm" />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Volume per month" description="Last 6 calendar months (UTC). Messages exclude internal notes; mentions are counted when collected." />
          <CardBody>
            <PlanVolume data={u.volume} />
            <MiniTable
              className="mt-3"
              columns={[{ header: "Month" }, { header: "Tickets", align: "right" }, { header: "Received", align: "right" }, { header: "Sent", align: "right" }, { header: "Mentions", align: "right" }]}
              rows={[...u.volume].reverse().slice(0, 3).map((r) => [monthLabel(r.month), num(r.tickets), num(r.messagesIn), num(r.messagesOut), num(r.mentions)])}
            />
          </CardBody>
          <CardFooter className="text-text-3">Limit: No limit configured.</CardFooter>
        </Card>

        <Card>
          <CardHeader title="API spend this month" description="Paid provider calls (DataForSEO) are billed to the brand owner's account budget." href={isAdmin && brand.role === "owner" ? "/settings?tab=budget" : undefined} />
          <CardBody>
            {!u.canSeeSpend || !u.spend ? (
              <EmptyState icon={<Lock className="h-5 w-5" />} title="Visible to brand admins" description="Ask the brand owner or an admin for spend details." className="py-8" />
            ) : (
              <div className="space-y-3 text-[13px]">
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[22px] font-semibold text-text">{money(u.spend.spent)}</span>
                    <span className="text-text-3">of {u.spend.budget == null ? "n/a" : money(u.spend.budget)} monthly budget</span>
                  </div>
                  {u.spend.budget != null && u.spend.budget > 0 && (
                    <Bar value={Math.min(u.spend.spent, u.spend.budget)} max={u.spend.budget} className="mt-2 h-2" color={u.spend.spent / u.spend.budget > 0.9 ? "var(--critical)" : "var(--brand)"} />
                  )}
                  <p className="mt-1.5 text-[12px] text-text-3">
                    Account of {u.spend.ownerName} · covers all of the owner&apos;s projects and tools, not only this brand. Budget is capped at {money(u.spend.cap)} per user (deployment cap {money(u.spend.globalCap)}).
                  </p>
                </div>
                <MiniTable
                  columns={[{ header: "Top endpoints" }, { header: "Calls", align: "right" }, { header: "Reserved", align: "right" }]}
                  rows={u.spend.endpoints.map((e) => [<span key="e" className="block max-w-[220px] truncate font-mono text-[12px] text-text-2" title={e.endpoint}>{e.endpoint}</span>, num(e.calls), money(e.reserved)])}
                  empty="No paid API calls this month."
                />
                {brand.role === "owner" && <Link href="/activity?tab=usage" className="inline-block text-[12.5px] text-link hover:underline">View usage details →</Link>}
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3}>
        <Card>
          <CardHeader title="Seats" description={`${num(u.seats.total)} member${u.seats.total === 1 ? "" : "s"} including the owner.`} href={`/cx/settings/team${q}`} />
          <CardBody>
            <ul className="space-y-1.5 text-[13px]">
              <li className="flex justify-between gap-2"><span className="text-text-2">Owner</span><span className="truncate font-medium text-text">{u.seats.owner?.name || u.seats.owner?.email || "n/a"}</span></li>
              {ROLE_ROWS.map(([k, label]) => (
                <li key={k} className="flex justify-between gap-2"><span className="text-text-2">{label}</span><span className="tabular-nums font-medium text-text">{num(u.seats.roles[k] ?? 0)}</span></li>
              ))}
            </ul>
            <div className="mt-3 border-t border-border pt-2 text-[12.5px]">
              <div className="flex justify-between gap-2"><span className="text-text-3">Agents handling conversations</span><span className="tabular-nums font-medium text-text">{num((u.seats.roles.agent ?? 0) + (u.seats.roles.supervisor ?? 0))}</span></div>
              <div className="flex justify-between gap-2"><span className="text-text-3">Seat limit</span><span className="text-text-2">No limit configured</span></div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Channels" description={connected ? `${num(connected)} connected · ${num(active)} active` : "No channels connected yet."} href={`/cx/settings/channels${q}`} />
          <CardBody>
            {u.channels.length === 0 ? (
              <p className="text-[12.5px] text-text-3">Connect email, live chat, a web form or social accounts in <Link href={`/cx/settings/channels${q}`} className="text-link hover:underline">Settings → Channels</Link>.</p>
            ) : (
              <ul className="divide-y divide-border">
                {u.channels.map((c) => (
                  <li key={c.kind} className="flex min-w-0 items-center gap-2 py-1.5 text-[13px]">
                    <ChannelIcon kind={c.kind} className="text-text-3" />
                    <span className="min-w-0 flex-1 truncate text-text">{channelLabel(c.kind)}<span className="ml-1.5 text-[11.5px] text-text-3">{c.lastSynced ? `synced ${timeAgo(c.lastSynced)}` : ""}</span></span>
                    <span className="flex shrink-0 gap-1">
                      {c.active > 0 && <Badge tone="good">{c.active} active</Badge>}
                      {c.paused > 0 && <Badge tone="neutral">{c.paused} paused</Badge>}
                      {c.error > 0 && <Badge tone="critical">{c.error} error</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-text-3">Channel limit: No limit configured.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Storage" description="Files stored for this brand." />
          <CardBody className="space-y-3 text-[13px]">
            <div>
              <div className="flex justify-between gap-2"><span className="text-text-2">Inbox attachments</span><span className="tabular-nums font-medium text-text">{fmtBytes(u.storage.inboxBytes)}</span></div>
              <div className="text-[12px] text-text-3">{num(u.storage.inboxFiles)} file{u.storage.inboxFiles === 1 ? "" : "s"} · No limit configured</div>
            </div>
            <div>
              <div className="flex justify-between gap-2"><span className="text-text-2">Publishing library</span><span className="tabular-nums font-medium text-text">{fmtBytes(u.storage.pubBytes)} <span className="font-normal text-text-3">/ {fmtBytes(quotaBytes)}</span></span></div>
              <Bar value={Math.min(u.storage.pubBytes, quotaBytes)} max={quotaBytes || 1} className="mt-1.5 h-1.5" color={quotaBytes && u.storage.pubBytes / quotaBytes > 0.9 ? "var(--critical)" : "var(--brand)"} />
              <div className="mt-1 text-[12px] text-text-3">{num(u.storage.pubFiles)} asset{u.storage.pubFiles === 1 ? "" : "s"} · quota set in <Link href={`/cx/publishing/assets${q}`} className="text-link hover:underline">Publishing</Link>, enforced on upload</div>
            </div>
            <div className="flex justify-between gap-2 border-t border-border pt-2"><span className="text-text-2">Total</span><span className="tabular-nums font-semibold text-text">{fmtBytes(totalBytes)}</span></div>
            <div className="flex justify-between gap-2 text-[12.5px]"><span className="text-text-3">Contacts stored</span><span className="tabular-nums text-text">{num(u.contacts)}</span></div>
          </CardBody>
        </Card>
      </Grid>
    </Page>
  );
}
