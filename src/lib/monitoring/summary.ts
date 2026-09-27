import type { SummaryProvider } from "@/lib/projects/summary-types";
import { latestJob } from "@/lib/jobs/queue";
import { getBrandSettings, mentionStats, ownMentions } from "./brand";

/** Project dashboard widget: brand mentions from Google News (demo social only with DEMO_DATA=true). */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const base = { tool: "brand-monitoring", label: "Brand Monitoring", href: `/brand-monitoring?project=${project.id}` };
    const settings = await getBrandSettings(project.id);
    if (!settings) return { ...base, state: "empty", cta: "Start monitoring" };
    const job = await latestJob(project.id, "monitoring.brand");
    const running = !!job && (job.status === "queued" || job.status === "running");
    const mentions = await ownMentions(project.id, settings.demoSocial);
    if (!mentions.length && running) return { ...base, state: "running" };
    const s = mentionStats(mentions);
    const delta = s.prev30 ? ((s.last30 - s.prev30) / s.prev30) * 100 : null;
    const weeks: number[] = [];
    for (let w = 11; w >= 0; w--) weeks.push(s.days.slice(Math.max(0, 90 - (w + 1) * 7), 90 - w * 7).reduce((a, d) => a + d.total, 0));
    return {
      ...base,
      state: running ? "running" : "ready",
      headline: { label: "Mentions (30 days)", value: String(s.last30), delta, upIsGood: true },
      stats: [
        { label: "Negative", value: s.last30 ? `${Math.round((s.negative30 / s.last30) * 100)}%` : "0%" },
        { label: "Unreviewed", value: String(s.unreviewed) },
        { label: "Sources", value: String(s.sources.length) },
      ],
      spark: weeks,
      updatedAt: settings.lastRunAt ?? settings.createdAt,
      note: settings.demoSocial ? "Google News + demo social" : "Google News",
    };
  },
];
