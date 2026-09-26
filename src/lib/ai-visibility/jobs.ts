import type { JobHandler } from "@/lib/jobs/types";
import { notify } from "@/lib/jobs/queue";
import { matchesDomain } from "@/lib/domain";
import { findProject } from "@/lib/projects";
import { askEngine, enabledLiveEngines, EngineFatalError, liveEngine, type LiveEngineId } from "@/lib/providers/ai-engines";
import { analyzeSentiment } from "@/lib/monitoring/sentiment";
import { loadAiContext } from "./context";
import type { AiContext } from "./engine";
import { listPrompts, saveLiveResult } from "./store";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstIndex = (text: string, terms: string[]) => {
  let best = -1;
  for (const t of terms) {
    const m = new RegExp(`\\b${escape(t.toLowerCase())}\\b`).exec(text);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
};

/** Detect brand/competitor mentions, order, citations and sentiment in a live answer. */
export function analyzeAnswer(ctx: AiContext, text: string, citedUrls: string[]) {
  const lower = text.toLowerCase();
  const own = firstIndex(lower, ctx.brandTerms);
  const rivals = ctx.competitors
    .map((c) => ({ name: c.name, index: firstIndex(lower, [c.name, ...(c.domain ? [c.domain] : [])].filter((t) => t.length >= 3)) }))
    .filter((c) => c.index >= 0);
  const order = [...(own >= 0 ? [{ name: ctx.brand, index: own }] : []), ...rivals].sort((a, b) => a.index - b.index);
  const position = own >= 0 ? order.findIndex((o) => o.name === ctx.brand) + 1 : null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => ctx.brandTerms.some((t) => s.toLowerCase().includes(t)));
  const sentiment = own >= 0 ? analyzeSentiment(sentences.join(" ") || text).label : null;
  const ownCited = citedUrls.filter((u) => matchesDomain(u, ctx.domain));
  return { mentioned: own >= 0, position, competitors: rivals.map((r) => r.name), sentiment, cited: ownCited.length > 0, ownCited };
}

/** Background job handlers owned by the ai-visibility module, keyed by job kind (prefix kinds with "ai-visibility."). */
export const jobs: Record<string, JobHandler> = {
  /**
   * Ask every connected AI engine (ChatGPT, Gemini, Perplexity, Google AI Overviews, Claude) each
   * tracked prompt with web search, and store what the answer says about the brand. An engine whose
   * key or quota fails is skipped for the rest of the run; the others continue.
   */
  "ai-visibility.run": async (job, ctx) => {
    const project = await findProject(job.owner_id ?? "", job.project_id);
    if (!project) throw new Error("Project not found.");
    const ai = await loadAiContext(project);
    const only = Array.isArray(job.payload.promptIds) ? new Set(job.payload.promptIds as string[]) : null;
    const prompts = (await listPrompts(project.id)).filter((p) => !only || only.has(p.id));
    if (!prompts.length) throw new Error("Add prompts to track first.");
    const requested = Array.isArray(job.payload.engines) ? new Set(job.payload.engines as string[]) : null;
    const engines = enabledLiveEngines().filter((e) => !requested || requested.has(e.id));
    if (!engines.length) throw new Error("No live AI engine is connected. Add an API key in the server environment (see Settings → Integrations).");
    const total = prompts.length * engines.length;
    const skipped = new Map<LiveEngineId, string>();
    const stats = new Map<LiveEngineId, { asked: number; mentioned: number; failed: number }>(engines.map((e) => [e.id, { asked: 0, mentioned: 0, failed: 0 }]));
    let done = 0;
    for (const p of prompts) {
      for (const engine of engines) {
        if (await ctx.cancelled()) return { cancelled: true, done };
        const s = stats.get(engine.id)!;
        await ctx.progress(done, total, `Asking ${engine.name}: “${p.prompt}”`);
        done++;
        if (skipped.has(engine.id)) continue;
        try {
          const answer = await askEngine(engine.id, p.prompt, { ownerId: project.owner_id, country: project.country });
          const cited = answer.citations.map((c) => c.url);
          const a = analyzeAnswer(ai, answer.text, cited);
          // Sources: inline citations; if the answer cited nothing inline, the pages its searches returned.
          const sourceUrls = cited.length ? cited : answer.searchResults.map((r) => r.url);
          s.asked++;
          if (a.mentioned) s.mentioned++;
          await saveLiveResult(project.id, job.id, {
            promptId: p.id,
            prompt: p.prompt,
            engine: engine.id,
            model: answer.model,
            mentioned: answer.present && a.mentioned,
            cited: answer.present && a.cited,
            position: answer.present ? a.position : null,
            citedUrls: a.ownCited,
            competitors: a.competitors,
            sources: [...new Set(sourceUrls.map(hostOf).filter((h): h is string => !!h))].slice(0, 20),
            sentiment: a.sentiment,
            answer: answer.present ? answer.text : "",
            error: answer.present ? null : "No AI answer was shown for this query.",
          });
        } catch (e) {
          s.failed++;
          const message = e instanceof Error ? e.message : String(e);
          await saveLiveResult(project.id, job.id, { promptId: p.id, prompt: p.prompt, engine: engine.id, model: engine.model(), mentioned: false, cited: false, position: null, citedUrls: [], competitors: [], sources: [], sentiment: null, answer: "", error: message });
          if (e instanceof EngineFatalError) skipped.set(engine.id, message);
        }
      }
    }
    await ctx.progress(total, total, "Done");
    const summary = engines.map((e) => {
      const s = stats.get(e.id)!;
      return skipped.has(e.id) ? `${e.name}: stopped (${skipped.get(e.id)})` : `${e.name}: mentioned in ${s.mentioned} of ${s.asked}`;
    });
    const allFailed = engines.every((e) => stats.get(e.id)!.asked === 0);
    await notify({
      ownerId: project.owner_id,
      projectId: project.id,
      tool: "ai-visibility",
      severity: allFailed ? "warning" : "info",
      title: `Live AI check finished for ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`,
      body: summary.join(" · "),
      link: `/ai-visibility?project=${project.id}&tab=live`,
    });
    if (allFailed) throw new Error(summary.join(" · "));
    return { prompts: prompts.length, engines: engines.map((e) => e.id), stats: Object.fromEntries(stats), skipped: Object.fromEntries(skipped) };
  },
};

export { liveEngine };
