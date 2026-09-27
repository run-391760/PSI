import type { Sentiment } from "@/lib/monitoring/sentiment";
import { aggregate, rate, shareOfVoice, visibilityScore, type AiContext } from "./engine";
import { ENGINES, type AnswerResult, type EngineId, type LiveResult, type PromptRow } from "./meta";
import type { PromptEngineCell, PromptSummary } from "./report";

/**
 * AI Visibility overview, prompts and cited sources computed only from stored live answers
 * (ai_live_results). Pure; unit-tested in tests/platform-real.test.ts.
 */

const DAY = 86400000;
const isEngine = (e: string): e is EngineId => ENGINES.some((x) => x.id === e);

export function toAnswer(r: LiveResult): AnswerResult | null {
  if (!isEngine(r.engine)) return null;
  return {
    engine: r.engine,
    day: r.createdAt.slice(0, 10),
    present: !r.error && !!r.answer,
    mentioned: r.mentioned,
    position: r.position,
    cited: r.cited,
    citedUrl: r.citedUrls[0] ?? null,
    competitors: r.competitors,
    brands: [],
    sentiment: r.sentiment,
    sources: r.sources,
  };
}

export function liveReport(ctx: AiContext, prompts: PromptRow[], live: LiveResult[], now = Date.now()) {
  const tracked = new Set(prompts.map((p) => p.prompt));
  const rows = live.filter((r) => tracked.has(r.prompt)).map((r) => ({ r, a: toAnswer(r) })).filter((x): x is { r: LiveResult; a: AnswerResult } => !!x.a);
  const age = (r: LiveResult) => now - Date.parse(r.createdAt);
  const cur = rows.filter((x) => age(x.r) < 7 * DAY);
  const prev = rows.filter((x) => age(x.r) >= 7 * DAY && age(x.r) < 14 * DAY);
  const aCur = aggregate(cur.map((x) => x.a), ctx);
  const aPrev = aggregate(prev.map((x) => x.a), ctx);
  const today = Math.floor(now / DAY) * DAY;
  const days = Array.from({ length: 30 }, (_, i) => new Date(today - (29 - i) * DAY).toISOString().slice(0, 10));
  const byDay = new Map<string, AnswerResult[]>();
  for (const x of rows) (byDay.get(x.a.day) ?? byDay.set(x.a.day, []).get(x.a.day)!).push(x.a);
  const trend = days.map((day) => {
    const list = byDay.get(day) ?? [];
    const row: Record<string, number | string | null> = { day };
    for (const e of ENGINES) {
      const ea = aggregate(list.filter((r) => r.engine === e.id), ctx);
      row[e.id] = ea.answers ? rate(ea.mentioned, ea.answers) : null;
    }
    return row;
  });
  const enginesSeen = new Set(rows.map((x) => x.a.engine));
  const engines = ENGINES.filter((e) => enginesSeen.has(e.id)).map((e) => {
    const a = aggregate(cur.filter((x) => x.a.engine === e.id).map((x) => x.a), ctx);
    const p = aggregate(prev.filter((x) => x.a.engine === e.id).map((x) => x.a), ctx);
    return { id: e.id, name: e.name, answers: a.answers, checks: cur.filter((x) => x.a.engine === e.id).length, mentioned: a.mentioned, cited: a.cited, avgPosition: a.positionN ? Math.round((a.positionSum / a.positionN) * 10) / 10 : null, sov: shareOfVoice(a, ctx.brand), score: visibilityScore(a), prevScore: p.answers ? visibilityScore(p) : null };
  });
  const sovRows = Object.entries(aCur.brandMentions)
    .map(([name, mentions]) => ({ name, mentions, you: name === ctx.brand }))
    .sort((a, b) => b.mentions - a.mentions);
  const sourceMap = new Map<string, { domain: string; answers: number; engines: Set<string> }>();
  const pageMap = new Map<string, number>();
  for (const x of cur) {
    if (!x.a.present) continue;
    for (const d of new Set(x.a.sources)) {
      const s = sourceMap.get(d) ?? { domain: d, answers: 0, engines: new Set<string>() };
      s.answers++;
      s.engines.add(x.a.engine);
      sourceMap.set(d, s);
    }
    for (const u of x.r.citedUrls) pageMap.set(u, (pageMap.get(u) ?? 0) + 1);
  }
  const competitorDomains = new Set(ctx.competitors.map((c) => c.domain).filter(Boolean));
  const own = (d: string) => d === ctx.domain || d.endsWith(`.${ctx.domain}`);
  const sources = [...sourceMap.values()]
    .map((s) => ({ domain: s.domain, answers: s.answers, share: rate(s.answers, aCur.answers), engines: [...s.engines] as EngineId[], type: own(s.domain) ? ("you" as const) : competitorDomains.has(s.domain) ? ("competitor" as const) : ("other" as const) }))
    .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain));
  const pages = [...pageMap.entries()].map(([url, citations]) => ({ url, citations })).sort((a, b) => b.citations - a.citations);

  const promptRows: PromptSummary[] = prompts.map((p) => {
    const mine = rows.filter((x) => x.r.prompt === p.prompt);
    const recent = mine.filter((x) => age(x.r) < 7 * DAY);
    const a = aggregate(recent.map((x) => x.a), ctx);
    const comp = new Map<string, number>();
    for (const x of recent) for (const c of x.a.competitors) comp.set(c, (comp.get(c) ?? 0) + 1);
    const sentiments = Object.entries(a.sentiment).sort((x, y) => y[1] - x[1]);
    const latest: PromptEngineCell[] = [];
    for (const e of ENGINES) {
      const x = mine.filter((m) => m.a.engine === e.id).sort((m, n) => n.r.createdAt.localeCompare(m.r.createdAt))[0];
      if (!x) continue;
      latest.push({ engine: e.id, present: x.a.present, mentioned: x.a.mentioned, cited: x.a.cited, position: x.a.position, citedUrl: x.a.citedUrl, competitors: x.a.competitors, sources: x.a.sources, sentiment: x.a.sentiment, answer: x.r.answer || x.r.error || "" });
    }
    const spark = days.map((d) => {
      const list = mine.filter((x) => x.a.day === d && x.a.present);
      return list.length ? Math.round((list.filter((x) => x.a.mentioned).length / list.length) * 100) : 0;
    });
    return {
      id: p.id,
      prompt: p.prompt,
      source: p.source,
      answers: a.answers,
      mentioned: a.mentioned,
      cited: a.cited,
      avgPosition: a.positionN ? Math.round((a.positionSum / a.positionN) * 10) / 10 : null,
      score: visibilityScore(a),
      sentiment: a.mentioned ? (sentiments[0][0] as Sentiment) : null,
      topCompetitor: [...comp.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      latest,
      spark,
    };
  });

  return {
    results: rows.length,
    current: aCur,
    previous: aPrev,
    score: visibilityScore(aCur),
    prevScore: aPrev.answers ? visibilityScore(aPrev) : null,
    sov: shareOfVoice(aCur, ctx.brand),
    prevSov: aPrev.answers ? shareOfVoice(aPrev, ctx.brand) : null,
    trend,
    engines,
    sovRows,
    sources,
    pages,
    prompts: promptRows,
    lastAt: rows[0]?.r.createdAt ?? null,
  };
}
export type LiveReport = ReturnType<typeof liveReport>;
