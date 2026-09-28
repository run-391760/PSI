import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { cxContext } from "@/lib/cx/context";
import { getDashboard, runWidget } from "@/lib/cx/insights/dashboards";
import { dateTimeLabel } from "@/lib/format";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { DashboardBoard } from "@/components/cx/insights/dashboard-board";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params, searchParams }: PageProps<"/cx/dashboards/[id]">) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Dashboards" />;
  const d = await getDashboard(brand.id, user.id, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const print = sp.print === "1";
  const now = new Date();
  const results = Object.fromEntries(await Promise.all(d.widgets.map(async (w) => [w.id, await runWidget(brand.id, w, now)] as const)));
  const [opts] = await query<{ channels: string[]; tags: string[] }>(
    `SELECT COALESCE((SELECT json_agg(DISTINCT k) FROM (SELECT channel_kind AS k FROM cx_tickets WHERE project_id=$1 UNION SELECT source FROM cx_mentions WHERE project_id=$1) a),'[]') AS channels,
            COALESCE((SELECT json_agg(DISTINCT tg) FROM (SELECT jsonb_array_elements_text(tags) AS tg FROM cx_tickets WHERE project_id=$1 UNION SELECT jsonb_array_elements_text(tags) FROM cx_mentions WHERE project_id=$1) b),'[]') AS tags`,
    [brand.id],
  );

  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Dashboards", href: cxHref("/cx/dashboards", brand.id) }, { label: d.name }]}
        title={d.name}
        subject={brand.name}
        description={d.description || undefined}
        meta={
          print ? (
            <Badge>Generated {dateTimeLabel(now)}</Badge>
          ) : (
            <BrandMeta switcher={switcher} current={brand.id}>
              <Badge tone={d.shared ? "good" : "neutral"}>{d.shared ? "Shared with brand" : "Private"}</Badge>
              {d.creator && <Badge>By {d.creator}</Badge>}
            </BrandMeta>
          )
        }
        actions={
          print ? (
            <>
              <ButtonLink href={cxHref(`/cx/dashboards/${d.id}`, brand.id)}>Back to editor</ButtonLink>
              <PrintButton label="Print / PDF" />
            </>
          ) : undefined
        }
      />
      <DashboardBoard
        brand={brand.id}
        meta={{ id: d.id, name: d.name, description: d.description, shared: d.shared, creator: d.creator }}
        widgets={d.widgets}
        results={results}
        options={{ channels: (opts?.channels ?? []).filter(Boolean).sort(), tags: (opts?.tags ?? []).filter(Boolean).sort() }}
        print={print}
      />
    </Page>
  );
}
