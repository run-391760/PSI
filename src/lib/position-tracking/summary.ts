import { query } from "@/lib/db";
import type { SummaryProvider } from "@/lib/projects/summary-types";
import { activeCheck } from "./run";
import { getCampaign } from "./store";

/** Project dashboard widget: visibility headline (+ delta vs 7 days earlier), keyword counts, 30-day sparkline. */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const href = `/position-tracking?project=${project.id}`;
    const base = { tool: "position-tracking", label: "Position Tracking", href };
    const campaign = await getCampaign(project.id);
    if (!campaign) return { ...base, state: "empty", cta: "Set up", note: "Track daily Google rankings for your keywords and competitors." };
    const device = campaign.device === "mobile" ? "mobile" : "desktop";
    const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM pt_keywords WHERE project_id=$1", [project.id]);
    const daily = await query<{ day: string; visibility: number; top3: number; top10: number }>(
      "SELECT day, visibility, top3, top10 FROM pt_daily WHERE project_id=$1 AND device=$2 AND domain=$3 ORDER BY day DESC LIMIT 30",
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
    return {
      ...base,
      state: "ready",
      headline: { label: "Visibility", value: `${Number(last.visibility).toFixed(2)}%`, delta: delta == null ? null : Math.round(delta * 100) / 100, upIsGood: true },
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
