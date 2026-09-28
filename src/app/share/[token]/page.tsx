import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { runWidget, sharedDashboard } from "@/lib/cx/insights/dashboards";
import { dateTimeLabel } from "@/lib/format";
import { DashboardBoard } from "@/components/cx/insights/dashboard-board";
import { PrintButton } from "@/components/ui/print-button";

export const metadata: Metadata = { title: "Shared dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Public, read-only view of a CX dashboard behind a revocable share token (no sign-in). */
export default async function SharedDashboardPage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const d = await sharedDashboard(token);
  if (!d) notFound();
  const now = new Date();
  const results = Object.fromEntries(await Promise.all(d.widgets.map(async (w) => [w.id, await runWidget(d.project_id, w, now, d.filters)] as const)));
  return (
    <main className="min-h-screen bg-bg px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold tracking-wide text-text-3 uppercase">{d.brand}</div>
            <h1 className="text-[22px] font-semibold tracking-tight text-text">{d.name}</h1>
            {d.description && <p className="mt-1 max-w-3xl text-[13px] text-text-2">{d.description}</p>}
            <p className="mt-1 text-[12px] text-text-3">Live data as of {dateTimeLabel(now)} · read-only shared view</p>
          </div>
          <div className="no-print"><PrintButton label="Print / PDF" /></div>
        </div>
        <DashboardBoard
          brand={d.project_id}
          meta={{ id: d.id, name: d.name, description: d.description, shared: d.shared, creator: null, theme: d.theme ?? "default", filters: d.filters ?? {} }}
          widgets={d.widgets}
          results={results}
          options={{ channels: [], tags: [], fields: [], classifications: [] }}
          print={false}
          readonly
        />
      </div>
    </main>
  );
}
