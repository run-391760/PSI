import { round } from "@/lib/seo/engine";
import type { Sentiment } from "@/lib/monitoring/sentiment";
import { aggregate, dayList, demoResults, rate, sampleAnswer, shareOfVoice, visibilityScore, type AiContext, type PromptResult } from "./engine";
import { ENGINES, type EngineId, type PromptRow } from "./meta";

export type PromptEngineCell = { engine: EngineId; present: boolean; mentioned: boolean; cited: boolean; position: number | null; citedUrl: string | null; competitors: string[]; sources: string[]; sentiment: Sentiment | null; answer: string };
export type PromptSummary = {
  id: string;
  prompt: string;
  source: "suggested" | "custom";
  answers: number;
  mentioned: number;
  cited: number;
  avgPosition: number | null;
  score: number;
  sentiment: Sentiment | null;
  topCompetitor: string | null;
  latest: PromptEngineCell[];
  spark: number[];
};

/** Everything the AI Visibility dashboard needs, from the deterministic demo answers. */
export function visibilityReport(ctx: AiContext, prompts: PromptRow[], now = Date.now()) {
  const days = dayList(30, now);
  const results = demoResults(
    ctx,
    prompts.map((p) => p.prompt),
    30,
    now,
  );
  const byDay = new Map<string, PromptResult[]>();
  for (const r of results) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
  const window = (from: number, to?: number) => days.slice(from, to).flatMap((d) => byDay.get(d) ?? []);
  const cur = window(-7);
  const prev = window(-14, -7);
  const aCur = aggregate(cur, ctx);
  const aPrev = aggregate(prev, ctx);

  const trend = days.map((day) => {
    const list = byDay.get(day) ?? [];
    const a = aggregate(list, ctx);
    const row: Record<string, number | string> = { day, score: visibilityScore(a), mention: rate(a.mentioned, a.answers), citation: rate(a.cited, a.answers) };
    for (const e of ENGINES) {
      const ea = aggregate(
        list.filter((r) => r.engine === e.id),
        ctx,
      );
      row[e.id] = rate(ea.mentioned, ea.answers);
    }
    return row;
  });

  const engines = ENGINES.map((e) => {
    const a = aggregate(
      cur.filter((r) => r.engine === e.id),
      ctx,
    );
    const p = aggregate(
      prev.filter((r) => r.engine === e.id),
      ctx,
    );
    return { id: e.id, name: e.name, answers: a.answers, mentioned: a.mentioned, cited: a.cited, avgPosition: a.positionN ? round(a.positionSum / a.positionN, 1) : null, sov: shareOfVoice(a, ctx.brand), score: visibilityScore(a), prevScore: visibilityScore(p), possible: prompts.length * 7 };
  });

  const sov = Object.entries(aCur.brandMentions)
    .map(([name, mentions]) => ({ name, mentions, you: name === ctx.brand }))
    .sort((a, b) => b.mentions - a.mentions);

  const sourceMap = new Map<string, { domain: string; answers: number; engines: Set<string> }>();
  const pageMap = new Map<string, number>();
  for (const r of cur) {
    if (!r.present) continue;
    for (const d of r.sources) {
      const s = sourceMap.get(d) ?? { domain: d, answers: 0, engines: new Set<string>() };
      s.answers++;
      s.engines.add(r.engine);
      sourceMap.set(d, s);
    }
    if (r.citedUrl) pageMap.set(r.citedUrl, (pageMap.get(r.citedUrl) ?? 0) + 1);
  }
  const competitorDomains = new Map(ctx.competitors.filter((c) => c.domain).map((c) => [c.domain!, c.name]));
  const sources = [...sourceMap.values()]
    .map((s) => ({ domain: s.domain, answers: s.answers, share: rate(s.answers, aCur.answers), engines: [...s.engines] as EngineId[], type: s.domain === ctx.domain ? ("you" as const) : competitorDomains.has(s.domain) ? ("competitor" as const) : ("other" as const) }))
    .sort((a, b) => b.answers - a.answers);
  const pages = [...pageMap.entries()].map(([url, citations]) => ({ url, citations })).sort((a, b) => b.citations - a.citations);

  const latestDay = days[days.length - 1];
  const promptRows: PromptSummary[] = prompts.map((p) => {
    const mine = cur.filter((r) => r.prompt === p.prompt);
    const a = aggregate(mine, ctx);
    const comp = new Map<string, number>();
    for (const r of mine) for (const c of r.competitors) comp.set(c, (comp.get(c) ?? 0) + 1);
    const sentiments = Object.entries(a.sentiment).sort((x, y) => y[1] - x[1]);
    const latest = (byDay.get(latestDay) ?? [])
      .filter((r) => r.prompt === p.prompt)
      .map((r) => ({ engine: r.engine, present: r.present, mentioned: r.mentioned, cited: r.cited, position: r.position, citedUrl: r.citedUrl, competitors: r.competitors, sources: r.sources, sentiment: r.sentiment, answer: sampleAnswer(ctx, p.prompt, r) }));
    const spark = days.map((d) => {
      const list = (byDay.get(d) ?? []).filter((r) => r.prompt === p.prompt && r.present);
      return list.length ? Math.round((list.filter((r) => r.mentioned).length / list.length) * 100) : 0;
    });
    return {
      id: p.id,
      prompt: p.prompt,
      source: p.source,
      answers: a.answers,
      mentioned: a.mentioned,
      cited: a.cited,
      avgPosition: a.positionN ? round(a.positionSum / a.positionN, 1) : null,
      score: visibilityScore(a),
      sentiment: a.mentioned ? (sentiments[0][0] as Sentiment) : null,
      topCompetitor: [...comp.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      latest,
      spark,
    };
  });

  return {
    days,
    latestDay,
    current: aCur,
    previous: aPrev,
    score: visibilityScore(aCur),
    prevScore: visibilityScore(aPrev),
    sov: shareOfVoice(aCur, ctx.brand),
    prevSov: shareOfVoice(aPrev, ctx.brand),
    trend,
    engines,
    sovRows: sov,
    sources,
    pages,
    prompts: promptRows,
  };
}
export type VisibilityReport = ReturnType<typeof visibilityReport>;
