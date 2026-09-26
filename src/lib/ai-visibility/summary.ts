import type { SummaryProvider } from "@/lib/projects/summary-types";
import { loadAiContext } from "./context";
import { visibilityReport } from "./report";
import { listPrompts } from "./store";

/** Project dashboard widget: AI visibility score across AI engines (demo data). */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const base = { tool: "ai-visibility", label: "AI Visibility", href: `/ai-visibility?project=${project.id}` };
    const prompts = await listPrompts(project.id);
    if (!prompts.length) return { ...base, state: "empty", cta: "Track AI prompts" };
    const r = visibilityReport(await loadAiContext(project), prompts);
    const delta = r.prevScore ? ((r.score - r.prevScore) / r.prevScore) * 100 : null;
    return {
      ...base,
      state: "ready",
      headline: { label: "AI visibility score", value: `${r.score}/100`, delta, upIsGood: true },
      stats: [
        { label: "Mentioned", value: `${r.current.mentioned}/${r.current.answers}` },
        { label: "Cited", value: `${r.current.cited}/${r.current.answers}` },
        { label: "Share of voice", value: `${r.sov}%` },
      ],
      spark: r.trend.map((t) => Number(t.score)),
      updatedAt: new Date().toISOString(),
      note: "Demo data · 7 days",
    };
  },
];
