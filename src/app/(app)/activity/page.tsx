import { Database, History, Plug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { money } from "@/lib/format";
import { listProjects } from "@/lib/projects";
import { monthlySpend } from "@/lib/providers/dataforseo";
import { liveEnabled } from "@/lib/providers/source";
import { accountSpend, cacheStats, dailySpend, globalBudgetUsd, integrations, jobCounts, jobModules, listJobRows, maxMonthlyUsd, spendByEndpoint, usageEvents } from "@/lib/reports/platform";
import { JOB_STATUS } from "@/lib/reports/kinds";
import { BarChart } from "@/components/charts/bar-chart";
import { JobsTable } from "@/components/dashboard/jobs-table";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { ActivityFilters } from "./activity-filters";
import { UsageTable } from "./usage-table";

export const metadata: Metadata = { title: "Activity" };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const tab = sp.tab === "usage" ? "usage" : "jobs";
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Monitoring & reports" }, { label: "Activity" }]}
        title="Activity"
        description="Background jobs across all tools and your paid data usage."
      />
      <TabsNav
        className="mb-4"
        items={[
          { href: "/activity", label: "Jobs" },
          { href: "/activity?tab=usage", label: "Data usage" },
        ]}
      />
      {tab === "jobs" ? <JobsTab userId={user.id} sp={sp} /> : <UsageTab userId={user.id} budgetMicros={user.monthly_budget_micros} />}
    </Page>
  );
}

async function JobsTab({ userId, sp }: { userId: string; sp: Record<string, string | string[] | undefined> }) {
  const status = str(sp.status);
  const filters = { status: status && status in JOB_STATUS ? status : null, module: str(sp.tool), projectId: str(sp.project), limit: 300 };
  const [rows, counts, modules, projects] = await Promise.all([listJobRows(userId, filters), jobCounts(userId), jobModules(userId), listProjects(userId)]);
  const filtered = !!(filters.status || filters.module || filters.projectId);
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Running" value={counts.running} sub="Right now" />
          <Metric label="Queued" value={counts.queued} sub="Waiting for a worker slot" />
          <Metric label="Finished (24h)" value={counts.done24h} />
          <Metric label="Failed (24h)" value={counts.failed24h} sub={counts.failed24h ? "Retry from the table below" : "All good"} />
          <Metric label="All jobs" value={counts.total} sub="Kept for your account" />
        </MetricStrip>
      </Card>
      <Card className="pt-3">
        <CardHeader title="Background jobs" description={filtered ? `${rows.length} matching jobs` : `Latest ${rows.length} jobs · progress updates live while jobs run`} className="pt-0" />
        {counts.total > 0 && <ActivityFilters modules={modules} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />}
        {counts.total === 0 ? (
          <div className="border-t border-border">
            <EmptyState
              icon={<History className="h-5 w-5" />}
              title="No background jobs yet"
              description="Site audits, rank checks, backlink audits, brand monitoring and exports run in the background. Start one from a tool and follow its progress here."
              action={
                <ButtonLink href="/site-audit" variant="primary">
                  <span className="inline-flex items-center gap-1.5 text-white">Run a Site Audit</span>
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <JobsTable rows={rows} />
        )}
      </Card>
    </>
  );
}

async function UsageTab({ userId, budgetMicros }: { userId: string; budgetMicros: string }) {
  const [spend, events, days, endpoints, account, cache] = await Promise.all([monthlySpend(userId), usageEvents(userId), dailySpend(userId), spendByEndpoint(userId), accountSpend(), cacheStats()]);
  const cap = maxMonthlyUsd();
  const budget = Math.min(Number(budgetMicros) / 1e6, cap);
  const used = budget ? Math.min(100, (spend / budget) * 100) : 0;
  const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const calls = days.reduce((s, d) => s + d.calls, 0);
  const actual = days.reduce((s, d) => s + d.actual, 0);
  const providers = integrations();
  return (
    <>
      {!liveEnabled() && (
        <Callout tone="info" className="mb-4" title="No paid provider connected" action={<ButtonLink href="/settings?tab=integrations" size="sm">Connect</ButtonLink>}>
          Nothing is charged. Reports that need web-scale index data show what to connect; connect DataForSEO in Settings to use it within your budget.
        </Callout>
      )}
      <Card className="mb-4">
        <MetricStrip>
          <Metric label={`Spend in ${month}`} value={money(spend)} sub="Reserved against your budget" />
          <Metric label="Monthly budget" value={money(budget)} sub={<Link href="/settings?tab=budget" className="hover:underline">Change in Settings</Link>} />
          <Metric label="Remaining" value={money(Math.max(0, budget - spend))} sub={`${(100 - used).toFixed(0)}% left`} />
          <Metric label="Paid API calls" value={calls.toLocaleString()} sub={`${money(actual)} actually charged`} />
        </MetricStrip>
        <div className="border-t border-border px-4 py-3">
          <div className="mb-1.5 flex justify-between text-[12px] text-text-2">
            <span>{used.toFixed(1)}% of your monthly budget used</span>
            <span className="text-text-3">Deployment-wide: {money(account)} of {money(globalBudgetUsd())}</span>
          </div>
          <Bar value={used} color={used > 90 ? "var(--critical)" : used > 70 ? "var(--warning)" : "var(--brand)"} className="h-2" />
        </div>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Daily spend" description={`Reserved cost per day in ${month} (USD)`} />
          <CardBody>
            <BarChart data={days.map((d) => ({ day: d.day, reserved: Math.round(d.reserved * 100) / 100 }))} xKey="day" xFormat="day" yFormat="money" series={[{ key: "reserved", label: "Reserved" }]} height={220} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Spend by endpoint" description="This month" />
          <CardBody>
            <MiniTable
              empty="No paid calls this month."
              columns={[{ header: "Endpoint" }, { header: "Calls", align: "right" }, { header: "Reserved", align: "right" }]}
              rows={endpoints.map((e) => [<span key="e" className="block max-w-[220px] truncate font-mono text-[12px]" title={e.endpoint}>{e.endpoint}</span>, e.calls, money(e.reserved)])}
            />
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4 pt-3">
        <CardHeader title="Usage events" description="Every paid call with its reservation and the cost the provider reported" className="pt-0" />
        <UsageTable rows={events} />
      </Card>

      <Grid cols={2}>
        <Card>
          <CardHeader title="Provider status" description="Configured through environment variables" href="/settings?tab=integrations" />
          <ul className="divide-y divide-border border-t border-border">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <Plug className="h-4 w-4 shrink-0 text-text-3" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text">{p.name}</div>
                  <div className="truncate text-[12px] text-text-3">{p.powers.join(" · ")}</div>
                </div>
                <Badge tone={p.status === "connected" || p.status === "enabled" ? "good" : p.status === "disabled" ? "neutral" : "warning"}>{p.statusLabel.split(" — ")[0]}</Badge>
              </li>
            ))}
          </ul>
          <CardFooter>
            <Link href="/settings?tab=integrations" className="text-link hover:underline">
              Manage integrations →
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader title="Response cache" description="Provider responses reused instead of paying twice (all users)" />
          <CardBody>
            {cache.length ? (
              <MiniTable
                columns={[{ header: "Source" }, { header: "Cached responses", align: "right" }, { header: "Still fresh", align: "right" }]}
                rows={cache.map((c) => [
                  <span key="s" className="inline-flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-text-3" />
                    {c.source}
                  </span>,
                  c.entries.toLocaleString(),
                  c.fresh.toLocaleString(),
                ])}
              />
            ) : (
              <p className="py-6 text-center text-[12.5px] text-text-3">Nothing cached yet. Live provider responses are cached so the same question is never paid for twice.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}
