import { query } from "@/lib/db";
import { demoAllowed } from "@/lib/data-mode";
import type { SummaryProvider } from "@/lib/projects/summary-types";
import { activeCheck } from "./run";
import { getCampaign } from "./store";

/**
 * Project dashboard widget (real data only): visibility headline (+ delta vs 7 days earlier) for DataForSEO
 * campaigns, average position + clicks for Search Console campaigns; demo campaigns only with DEMO_DATA=true.
 */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const href = `/position-tracking?project=${project.id}`;
    const base = { tool: "position-tracking", label: "Position Tracking", href };
    const campaign = await getCampaign(project.id);
    if (!campaign) return { ...base, state: "empty", cta: "Set up", note: "Track daily Google rankings for your keywords and competitors." };
    if (campaign.source === "demo" && !demoAllowed()) return { ...base, state: "empty", cta: "Switch to real data", note: "This campaign has demo data. Switch it to Search Console or DataForSEO." };
    const device = campaign.device === "mobile" ? "mobile" : "desktop";
    const gsc = campaign.source === "search-console";
    const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM pt_keywords WHERE project_id=$1", [project.id]);
    const daily = await query<{ day: string; visibility: number; top3: number; top10: number; avg_position: number | null; clicks: number | null }>(
      "SELECT day, visibility, top3, top10, avg_position, clicks FROM pt_daily WHERE project_id=$1 AND device=$2 AND domain=$3 ORDER BY day DESC LIMIT 30",
      [project.id, device, project.domain],
    );
    if (!daily.length) {
      const job = await activeCheck(project.id);
      return { ...base, state: job ? "running" : "empty", cta: job ? undefined : "Run first check", note: job ? "Collecting rankings…" : "No rankings collected yet." };
    }
    const series = [...daily].reverse();
    const last = series[series.length - 1];
    const weekAgo = series[Math.max(0, series.length - 8)];
    const delta = series.length > 1 ? Number(last.visibility) - Number(weekAgo.visibility) : null;
    if (gsc) {
      const pos = (d: { avg_position: number | null }) => (d.avg_position == null ? null : Number(d.avg_position));
      const a = pos(weekAgo);
      const b = pos(last);
      const clicks7 = series.slice(-7).reduce((sum, d) => sum + Number(d.clicks ?? 0), 0);
      return {
        ...base,
        state: "ready",
        headline: { label: "Avg. position", value: b == null ? "n/a" : b.toFixed(1), delta: a != null && b != null && series.length > 1 ? Math.round((a - b) * 10) / 10 : null, deltaUnit: "absolute", upIsGood: true },
        stats: [
          { label: "Keywords", value: n.toLocaleString("en-US") },
          { label: "Top 10", value: String(last.top10) },
          { label: "Clicks (7 days)", value: Math.round(clicks7).toLocaleString("en-US") },
        ],
        spark: series.map((d) => Math.round(Number(d.visibility) * 100) / 100),
        updatedAt: campaign.lastCheckAt ?? undefined,
        note: `Search Console · data through ${last.day}`,
      };
    }
    return {
      ...base,
      state: "ready",
      headline: { label: "Visibility", value: `${Number(last.visibility).toFixed(2)}%`, delta: delta == null ? null : Math.round(delta * 100) / 100, deltaUnit: "points", upIsGood: true },
      stats: [
        { label: "Keywords", value: n.toLocaleString("en-US") },
        { label: "Top 3", value: String(last.top3) },
        { label: "Top 10", value: String(last.top10) },
      ],
      spark: series.map((d) => Math.round(Number(d.visibility) * 100) / 100),
      updatedAt: campaign.lastCheckAt ?? undefined,
      note: campaign.source === "demo" ? "Demo data" : "DataForSEO",
    };
  },
];
