import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";

/**
 * /cx/reports opens Share of Voice. Old tab links keep working:
 * ?tab=trend → Ticketing, sla/performance/tat → Ticketing tabs, mine → My Dashboard, downloads → Download centre.
 */
type SP = Record<string, string | string[] | undefined>;
const LEGACY: Record<string, { path: string; tab?: string }> = {
  trend: { path: "/cx/reports/ticketing" },
  sla: { path: "/cx/reports/ticketing", tab: "sla" },
  performance: { path: "/cx/reports/ticketing", tab: "performance" },
  tat: { path: "/cx/reports/ticketing", tab: "tat" },
  mine: { path: "/cx/reports/my-dashboard" },
  downloads: { path: "/cx/reports/download" },
};

export default async function ReportsIndex({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePageUser();
  const sp = await searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "tab" && k !== "days") p.set(k, v);
  const target = LEGACY[typeof sp.tab === "string" ? sp.tab : ""] ?? { path: "/cx/reports/share-of-voice" };
  if (target.tab) p.set("tab", target.tab);
  const days = Number(sp.days);
  if ([7, 30, 90].includes(days) && !p.has("from")) {
    const to = new Date();
    p.set("from", new Date(to.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10));
    p.set("to", to.toISOString().slice(0, 10));
  }
  const qs = p.toString();
  redirect(qs ? `${target.path}?${qs}` : target.path);
}
