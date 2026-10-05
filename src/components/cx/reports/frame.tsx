import { BarChart3, PlugZap } from "lucide-react";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { ShowHidden } from "@/components/shell/hideable";
import { ScopePicker } from "@/components/cx/scope-picker";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { aiConfigured } from "@/lib/cx/ai";
import type { ReportCtx } from "@/lib/cx/reports/data";
import { ReportFilterBar, ReportProvider } from "./kit";

const cx = (path: string, brand: string) => `${path}?brand=${encodeURIComponent(brand)}`;

/**
 * Shared frame of every report page: header (brand switcher, source badge, "Show hidden"), the filter bar
 * (ScopePicker, date range, media types, publish/created basis — all in the URL) and the ReportProvider
 * (shared series toggles + drill-down drawer).
 */
export function ReportFrame({
  ctx,
  switcher,
  page,
  title,
  description,
  source = "Source: stored mentions and tickets",
  mediaOptions = [],
  filters = { scope: true, media: true },
  actions,
  children,
}: {
  ctx: Pick<ReportCtx, "brandId" | "brandName" | "today" | "filters"> & { scope?: ReportCtx["scope"] };
  switcher: { id: string; name: string; domain: string }[];
  /** Page id; hidden widgets are scoped "cx-reports.<page>". */
  page: string;
  title: string;
  description?: ReactNode;
  source?: string;
  mediaOptions?: { id: string; label: string; count?: number }[];
  filters?: { scope?: boolean; media?: boolean; basis?: boolean; date?: boolean };
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Page wide>
      <PageHeader
        className="mb-3"
        breadcrumbs={[{ label: "CX", href: cx("/cx", ctx.brandId) }, { label: "Reports", href: cx("/cx/reports", ctx.brandId) }, { label: title }]}
        title={title}
        description={description}
        meta={
          <>
            <BrandSwitcher brands={switcher} current={ctx.brandId} />
            <Badge>{source}</Badge>
          </>
        }
        actions={
          <>
            {actions}
            <ShowHidden scope={`cx-reports.${page}`} />
          </>
        }
      />
      {filters.date !== false && (
        <ReportFilterBar
          scope={filters.scope && ctx.scope ? <ScopePicker options={ctx.scope.options} placeholder={`All of ${ctx.brandName}`} /> : undefined}
          range={ctx.filters.range}
          today={ctx.today}
          media={ctx.filters.media}
          mediaOptions={mediaOptions}
          basis={ctx.filters.basis}
          showBasis={filters.basis}
          showMedia={filters.media}
        />
      )}
      <ReportProvider brand={ctx.brandId} ai={aiConfigured()}>
        <div className="space-y-4">{children}</div>
      </ReportProvider>
    </Page>
  );
}

/** Empty state for a brand/period without data: what the report shows and how to get data (never fake numbers). */
export function ReportEmpty({ brand, what, kind = "listening" }: { brand: string; what: string; kind?: "listening" | "tickets" | "tasks" | "surveys" }) {
  const cta =
    kind === "listening" ? (
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href={cx("/cx/listening/topics", brand)} variant="primary">Set up listening topics</ButtonLink>
        <ButtonLink href={cx("/cx/settings/channels", brand)}>Connect channels</ButtonLink>
      </div>
    ) : kind === "tickets" ? (
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href={cx("/cx/settings/channels", brand)} variant="primary">Connect a channel</ButtonLink>
        <ButtonLink href={cx("/cx/inbox", brand)}>Open tickets</ButtonLink>
      </div>
    ) : kind === "tasks" ? (
      <ButtonLink href={cx("/cx/tasks", brand)} variant="primary">Open tasks</ButtonLink>
    ) : (
      <ButtonLink href={cx("/cx/surveys", brand)} variant="primary">Set up a survey</ButtonLink>
    );
  return (
    <Card>
      <EmptyState icon={kind === "listening" ? <BarChart3 className="h-5 w-5" /> : <PlugZap className="h-5 w-5" />} title="No data for this scope and period" description={`${what} Widen the date range or scope, or connect sources.`} action={cta} />
    </Card>
  );
}
