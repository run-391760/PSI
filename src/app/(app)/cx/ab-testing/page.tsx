import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { NewAbTestButton } from "@/components/cx/ops/ab-new";
import { AbTestsTable } from "@/components/cx/ops/ab-table";
import { NoConnectionCallout } from "@/components/cx/ops/ab-ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listTests } from "@/lib/cx/ops/ab";
import { connections, getSettings, requireBrand } from "@/lib/cx/publishing/data";

export const metadata: Metadata = { title: "A/B testing" };

export default async function AbTestingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "A/B testing" }];
  if (!brand) return <NoBrand title="A/B testing" breadcrumbs={crumbs} redirect="/cx/ab-testing" />;

  const [tests, conns, settings, access] = await Promise.all([listTests(brand.id), connections(brand.id), getSettings(brand.id), requireBrand(user.id, brand.id).catch(() => null)]);
  const canAuthor = !!access?.canAuthor;
  const h = await headers();
  const origin = (process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`).replace(/\/$/, "");
  const q = `brand=${brand.id}`;
  const connected = conns.filter((c) => c.connected && c.publishApi);
  const channelOpts = conns.map((c) => ({ kind: c.kind, name: c.name, connected: c.connected, publishApi: c.publishApi }));
  const running = tests.filter((t) => t.status === "running");
  const decided = tests.filter((t) => t.winner === "a" || t.winner === "b");
  const clicks = tests.reduce((s, t) => s + (t.clicksA ?? 0) + (t.clicksB ?? 0), 0);
  const ready = running.filter((t) => t.significant).length;
  const newButton = canAuthor ? <NewAbTestButton brandId={brand.id} channels={channelOpts} requireApproval={settings.requireApproval} origin={origin} /> : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={crumbs}
        title="A/B testing"
        subject={brand.name}
        description="Publish two variants of a post at the same time through Publishing and compare real clicks on their tracked links. A winner is called only when both variants have enough clicks and the split is statistically significant."
        meta={
          <>
            <Badge tone="neutral">Real data · tracked-link clicks</Badge>
            <Badge tone={connected.length ? "good" : "neutral"}>{connected.length ? `${connected.length} publishing channel${connected.length > 1 ? "s" : ""} connected` : "No publishing API connected"}</Badge>
            {settings.requireApproval && <Badge tone="info">Approval required</Badge>}
            {!canAuthor && <Badge>Read-only</Badge>}
          </>
        }
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            {newButton}
          </>
        }
      />

      {!connected.length && <NoConnectionCallout conns={conns} brandId={brand.id} className="mb-4" />}

      {tests.length > 0 && (
        <Card className="mb-4">
          <MetricStrip>
            <Metric label="Tests" value={tests.length.toLocaleString("en-US")} />
            <Metric label="Running" value={running.length.toLocaleString("en-US")} sub={ready ? `${ready} with a significant leader` : undefined} />
            <Metric label="Winners declared" value={decided.length.toLocaleString("en-US")} sub={`${tests.filter((t) => t.status === "completed").length} completed`} />
            <Metric label="Tracked clicks" value={clicks.toLocaleString("en-US")} info="Human clicks on the variants' short links (bots excluded), counted until each test's end." />
          </MetricStrip>
        </Card>
      )}

      {tests.length ? (
        <Card className="p-3">
          <AbTestsTable brandId={brand.id} rows={tests} />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<FlaskConical className="h-5 w-5" />}
            title="No A/B tests yet"
            description="Write two versions of a post (different hook, wording or call to action), pick the channels and the destination link. Both go out together, each with its own tracked short link, and the clicks show which one works better."
            action={newButton}
          />
        </Card>
      )}

      <p className="mt-4 text-[12px] text-text-3">
        Variants are regular posts in <Link href={`/cx/publishing?${q}`} className="text-link hover:underline">Publishing</Link> (titled “test name · A / B”), so approval, scheduling and the activity log work as usual. Clicks come from the publishing module&apos;s short links; engagement (likes, comments, shares) is shown only for networks whose insights API is connected.
      </p>
    </Page>
  );
}
