import type { SummaryProvider } from "@/lib/projects/summary-types";
import { compact } from "@/lib/format";
import { query } from "@/lib/db";
import { getProjectGoogle, organicInsights } from "./data";
import { googleConfigured } from "./oauth";

/** Project dashboard widget: real Search Console clicks (and GA4 organic sessions) for the last 28 days. */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const href = `/organic-traffic-insights?project=${project.id}`;
    const base = { tool: "organic-traffic-insights", label: "Organic Traffic Insights", href };
    if (!googleConfigured()) return { ...base, state: "empty", cta: "Set up", note: "Connect Google Search Console and GA4" };
    const [link, [conn]] = await Promise.all([getProjectGoogle(project.id), query<{ user_id: string }>("SELECT user_id FROM google_connections WHERE user_id=$1", [project.owner_id])]);
    if (!conn || (!link.gscSite && !link.ga4Property)) return { ...base, state: "empty", cta: conn ? "Link properties" : "Connect Google" };
    const { data, fetchedAt } = await organicInsights(project.owner_id, link, 28);
    const pctChange = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
    if (data.gsc)
      return {
        ...base,
        state: "ready",
        headline: { label: "Clicks (28 days)", value: compact(data.gsc.totals.clicks), delta: pctChange(data.gsc.totals.clicks, data.gsc.previous.clicks), deltaUnit: "percent", upIsGood: true },
        stats: [
          { label: "Impressions", value: compact(data.gsc.totals.impressions) },
          { label: "Avg. position", value: data.gsc.totals.position ? data.gsc.totals.position.toFixed(1) : "n/a" },
          ...(data.ga4 ? [{ label: "Organic sessions", value: compact(data.ga4.organic.sessions) }] : []),
        ],
        spark: data.gsc.daily.map((d) => d.clicks),
        updatedAt: fetchedAt,
      };
    if (data.ga4)
      return {
        ...base,
        state: "ready",
        headline: { label: "Organic sessions (28 days)", value: compact(data.ga4.organic.sessions), delta: pctChange(data.ga4.organic.sessions, data.ga4.organicPrevious.sessions), deltaUnit: "percent", upIsGood: true },
        stats: [
          { label: "Engagement", value: `${Math.round(data.ga4.organic.engagementRate * 100)}%` },
          { label: "Key events", value: compact(data.ga4.organic.keyEvents) },
        ],
        spark: data.ga4.daily.map((d) => d.organic),
        updatedAt: fetchedAt,
      };
    return { ...base, state: "error", note: data.gscError ?? data.ga4Error ?? "No data" };
  },
];
