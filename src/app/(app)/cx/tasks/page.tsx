import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { TasksClient } from "@/components/cx/ops/tasks-client";
import { Page, PageHeader } from "@/components/shell/page";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { TabsNav } from "@/components/ui/tabs";
import { requirePageUser } from "@/lib/auth";
import { getClassificationTree } from "@/lib/cx/admin/fields";
import { cxContext } from "@/lib/cx/context";
import { listAgents } from "@/lib/cx/inbox/store";
import { fireDueTasks, getTask, listTasks, taskCounts, TASK_VIEWS, type TaskView } from "@/lib/cx/ops/tasks";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Tasks" }];
  if (!brand) return <NoBrand title="Tasks" breadcrumbs={crumbs} redirect="/cx/tasks" />;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view = (TASK_VIEWS.some((v) => v.id === s("view")) ? s("view") : "mine") as TaskView;
  await fireDueTasks(brand.id).catch(() => 0);
  const filters = { view, q: s("q"), status: s("status"), priority: s("priority"), assignee: s("assignee") };
  const [tasks, counts, agents, tree, open] = await Promise.all([
    listTasks(brand.id, user.id, filters),
    taskCounts(brand.id, user.id),
    listAgents(brand.id),
    getClassificationTree(brand.id).catch(() => []),
    s("task") ? getTask(brand.id, s("task")!) : Promise.resolve(null),
  ]);
  const base = `/cx/tasks?brand=${brand.id}`;
  return (
    <Page>
      <PageHeader
        title="Tasks"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="CRM tasks for follow-ups: standalone or created from a ticket, with due dates, reminders, assignees, priority and classification. Changes show up in the linked ticket's activity."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <MetricStrip className="mb-4 grid-cols-2 divide-y-0 sm:grid-cols-none">
        <Metric label="My open tasks" value={num(counts.mine)} size="sm" href={`${base}&view=mine`} />
        <Metric label="Due today" value={num(counts.today)} size="sm" href={`${base}&view=today`} />
        <Metric label="Overdue" value={num(counts.overdue)} size="sm" href={`${base}&view=overdue`} info="Open tasks past their due time (all assignees)." />
        <Metric label="Created by me" value={num(counts.created)} size="sm" href={`${base}&view=created`} />
        <Metric label="Completed" value={num(counts.done)} size="sm" href={`${base}&view=done`} />
      </MetricStrip>
      <TabsNav param="view" className="mb-3" items={TASK_VIEWS.map((v) => ({ href: `${base}&view=${v.id}`, label: v.label, count: counts[v.id], match: v.id }))} />
      <TasksClient
        brand={brand.id}
        me={{ id: user.id, name: user.name || user.email }}
        role={brand.role}
        view={view}
        filters={{ q: filters.q ?? "", status: filters.status ?? "", priority: filters.priority ?? "", assignee: filters.assignee ?? "" }}
        tasks={tasks}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        tree={tree}
        open={open}
      />
    </Page>
  );
}
