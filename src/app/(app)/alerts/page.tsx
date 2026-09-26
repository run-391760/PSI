import { BellRing, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { listRules, ruleProjects } from "@/lib/position-tracking/alerts";
import { listNotifications, notificationFacets, type NotificationFilter } from "@/lib/position-tracking/notifications";
import { ALL_TOOLS } from "@/components/shell/nav";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { NotificationFilters } from "@/components/alerts/notification-filters";
import { NotificationList } from "@/components/alerts/notification-list";
import { NewRuleButton } from "@/components/alerts/rule-dialog";
import { RulesTable } from "@/components/alerts/rules-table";
import { SEVERITY_META, type Severity } from "@/components/alerts/severity";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { TabsNav } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Alerts" };

const PAGE_SIZE = 30;
const SEVERITIES: Severity[] = ["critical", "warning", "success", "info"];

function toolLabel(tool: string) {
  const byHref = ALL_TOOLS.find((t) => t.href === `/${tool}` || t.href.endsWith(`/${tool}`));
  if (byHref) return byHref.label;
  const aliases: Record<string, string> = { backlinks: "Backlinks", monitoring: "Monitoring", local: "Local SEO", content: "Content", keywords: "Keywords", competitive: "Competitive research", reports: "My Reports", "ai-visibility": "AI Visibility", core: "System" };
  return aliases[tool] ?? tool.replace(/[-_.]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = str("tab") === "rules" ? "rules" : "notifications";
  const severity = SEVERITIES.includes(str("severity") as Severity) ? (str("severity") as Severity) : undefined;
  const filter: NotificationFilter = { tool: str("tool") || undefined, severity, project: str("project") || undefined, unread: str("unread") === "1" || undefined };
  const page = Math.max(1, Math.floor(Number(str("page")) || 1));

  const [facets, projects, rules, rp, list] = await Promise.all([
    notificationFacets(user.id),
    listProjects(user.id),
    listRules(user.id),
    ruleProjects(user.id),
    tab === "notifications" ? listNotifications(user.id, filter, PAGE_SIZE, (page - 1) * PAGE_SIZE) : Promise.resolve({ items: [], total: 0 }),
  ]);
  const labels: Record<string, string> = Object.fromEntries(facets.tools.map((t) => [t.tool, toolLabel(t.tool)]));
  const filtered = Boolean(filter.tool || filter.severity || filter.project || filter.unread);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    return `/alerts?${p.toString()}`;
  };
  const sevCount = (s: Severity) => facets.severities.find((x) => x.severity === s);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Monitoring & reports" }, { label: "Alerts", href: "/alerts" }]}
        title="Alerts"
        description="Notifications from every tool — ranking changes, audit issues, mentions and finished jobs — plus the rules that trigger them."
        meta={
          <>
            <Badge tone={facets.totals.unread ? "brand" : "neutral"}>{facets.totals.unread} unread</Badge>
            <Badge>{facets.totals.week} in the last 7 days</Badge>
            <Badge>
              {rules.filter((r) => r.enabled).length} active rule{rules.filter((r) => r.enabled).length === 1 ? "" : "s"}
            </Badge>
          </>
        }
        actions={<NewRuleButton projects={rp} variant={tab === "rules" ? "primary" : "secondary"} label="New alert rule" />}
      />

      <TabsNav
        className="mb-4"
        items={[
          { href: "/alerts", label: "Notifications", count: facets.totals.unread || undefined },
          { href: "/alerts?tab=rules", label: "Rules", count: rules.length || undefined },
        ]}
      />

      {tab === "notifications" ? (
        <Grid cols={2} className="lg:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="min-w-0">
            <NotificationFilters tools={facets.tools.map((t) => ({ id: t.tool, label: labels[t.tool], total: t.total }))} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
            <div className="border-t border-border">
              <NotificationList items={list.items} toolLabels={labels} filter={filter} filtered={filtered} emptyAll={facets.totals.total === 0} />
            </div>
            {list.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12.5px] text-text-2">
                <span>
                  {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(list.total, page * PAGE_SIZE).toLocaleString()} of {list.total.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <Link aria-disabled={page <= 1} href={qs({ page: String(page - 1) })} className={cn(buttonClass("ghost", "sm"), page <= 1 && "pointer-events-none opacity-40")} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </Link>
                  <span className="tabular">
                    {page} / {pages}
                  </span>
                  <Link aria-disabled={page >= pages} href={qs({ page: String(page + 1) })} className={cn(buttonClass("ghost", "sm"), page >= pages && "pointer-events-none opacity-40")} aria-label="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </span>
              </div>
            )}
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="By severity" />
              <CardBody>
                <ul className="space-y-1">
                  {SEVERITIES.map((s) => {
                    const c = sevCount(s);
                    const M = SEVERITY_META[s];
                    return (
                      <li key={s}>
                        <Link href={qs({ severity: filter.severity === s ? null : s, page: null })} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-3", filter.severity === s && "bg-surface-3")}>
                          <M.icon className={cn("h-4 w-4", M.iconCls)} />
                          <span className="flex-1 text-text-2">{M.label}</span>
                          {c?.unread ? <span className="text-[11.5px] text-text-3">{c.unread} new</span> : null}
                          <span className="tabular w-8 text-right font-medium text-text">{c?.total ?? 0}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="By tool" />
              <CardBody>
                {facets.tools.length ? (
                  <ul className="space-y-1">
                    {facets.tools.map((t) => (
                      <li key={t.tool}>
                        <Link href={qs({ tool: filter.tool === t.tool ? null : t.tool, page: null })} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-3", filter.tool === t.tool && "bg-surface-3")}>
                          <span className="flex-1 truncate text-text-2">{labels[t.tool]}</span>
                          {t.unread ? <span className="text-[11.5px] text-text-3">{t.unread} new</span> : null}
                          <span className="tabular w-8 text-right font-medium text-text">{t.total}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-text-3">No notifications yet.</p>
                )}
              </CardBody>
            </Card>
            {rules.length === 0 && (
              <Callout tone="info" title="Set up ranking alerts">
                Create rules to be notified when keywords move. <Link href="/alerts?tab=rules" className="text-link hover:underline">Manage rules →</Link>
              </Callout>
            )}
          </div>
        </Grid>
      ) : (
        <Card>
          <CardHeader
            title="Alert rules"
            description={`${rules.length} rule${rules.length === 1 ? "" : "s"} across ${new Set(rules.map((r) => r.projectId)).size} project${new Set(rules.map((r) => r.projectId)).size === 1 ? "" : "s"} · evaluated after every Position Tracking check`}
          />
          {rp.length === 0 ? (
            <CardBody>
              <Callout tone="info" title="No tracking campaigns yet">
                Alert rules watch Position Tracking campaigns. <Link href="/position-tracking" className="text-link hover:underline">Set up Position Tracking →</Link>
              </Callout>
            </CardBody>
          ) : (
            <RulesTable rules={rules} projects={rp} emptyAction={<NewRuleButton projects={rp} label="Create your first rule" />} />
          )}
          <CardBody className="border-t border-border pt-3 text-[12px] text-text-3">
            <span className="inline-flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5" /> Each rule notifies at most once per day per keyword; more than 10 matches are summarized in one alert.
            </span>
          </CardBody>
        </Card>
      )}
    </Page>
  );
}
