import type { SummaryProvider } from "@/lib/projects/summary-types";
import { enabledLiveEngines } from "@/lib/providers/ai-engines";
import { loadAiContext } from "./context";
import { liveReport } from "./live-report";
import { listPrompts, liveResults } from "./store";

/** Project dashboard widget: AI visibility computed from real live answers (last 7 days). */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const base = { tool: "ai-visibility", label: "AI Visibility", href: `/ai-visibility?project=${project.id}` };
    const prompts = await listPrompts(project.id);
    if (!prompts.length) return { ...base, state: "empty", cta: "Track AI prompts" };
    const live = await liveResults(project.id);
    const r = liveReport(await loadAiContext(project), prompts, live);
    if (!r.current.answers)
      return { ...base, state: "empty", cta: enabledLiveEngines().length ? "Run a live check" : "Connect an AI engine", note: `${prompts.length} prompts tracked` };
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
      updatedAt: r.lastAt ?? undefined,
      note: `Live answers · ${r.engines.map((e) => e.name).join(", ")}`,
    };
  },
];
