import { AppError } from "@/lib/domain";
import { cached, flagEnabled, type Sourced } from "./source";

/**
 * Google PageSpeed Insights v5 (free; optional PAGESPEED_API_KEY raises the quota). Returns Lighthouse
 * lab metrics plus CrUX field data (page and origin) when Google has enough real-user traffic.
 * Results are cached for 24 h per URL + strategy. Failures are thrown (never cached).
 */
export type PsiStrategy = "mobile" | "desktop";
export type PsiField = { lcp: number | null; inp: number | null; cls: number | null; fcp: number | null; ttfb: number | null; overall: string | null };
export type PsiReport = {
  url: string;
  finalUrl: string | null;
  strategy: PsiStrategy;
  performance: number | null;
  lab: { lcp: number | null; cls: number | null; tbt: number | null; fcp: number | null; si: number | null; tti: number | null };
  field: PsiField | null;
  origin: PsiField | null;
  opportunities: { id: string; title: string; savingsMs: number | null }[];
};

export const pagespeedEnabled = () => flagEnabled("ENABLE_PAGESPEED");

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function mapField(exp: any): PsiField | null {
  const m = exp?.metrics;
  if (!m) return null;
  const p = (k: string) => num(m[k]?.percentile);
  const cls = p("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  return {
    lcp: p("LARGEST_CONTENTFUL_PAINT_MS"),
    inp: p("INTERACTION_TO_NEXT_PAINT"),
    cls: cls == null ? null : cls / 100,
    fcp: p("FIRST_CONTENTFUL_PAINT_MS"),
    ttfb: p("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    overall: typeof exp?.overall_category === "string" ? exp.overall_category : null,
  };
}

async function run(url: string, strategy: PsiStrategy): Promise<PsiReport> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
  let response: Response;
  try {
    response = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: AbortSignal.timeout(60000), cache: "no-store" });
  } catch (e) {
    throw new AppError((e as Error)?.name === "TimeoutError" ? "PageSpeed Insights timed out after 60 s." : "PageSpeed Insights could not be reached.", 504);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (response.status === 429)
      throw new AppError(process.env.PAGESPEED_API_KEY ? "PageSpeed Insights quota exceeded for the configured API key." : "PageSpeed Insights anonymous quota exceeded. Set PAGESPEED_API_KEY to measure Core Web Vitals.", 429);
    throw new AppError(`PageSpeed Insights: ${body?.error?.message?.slice(0, 200) || `HTTP ${response.status}`}`, 502);
  }
  const data = (await response.json()) as any;
  const lh = data?.lighthouseResult;
  const audits = lh?.audits ?? {};
  const a = (id: string) => num(audits[id]?.numericValue);
  const opportunities = Object.values(audits as Record<string, any>)
    .filter((x) => x?.details?.type === "opportunity" && (x?.score ?? 1) < 0.9)
    .map((x) => ({ id: String(x.id), title: String(x.title ?? x.id), savingsMs: num(x.details?.overallSavingsMs) }))
    .sort((x, y) => (y.savingsMs ?? 0) - (x.savingsMs ?? 0))
    .slice(0, 6);
  const score = num(lh?.categories?.performance?.score);
  return {
    url,
    finalUrl: typeof lh?.finalDisplayedUrl === "string" ? lh.finalDisplayedUrl : (lh?.finalUrl ?? null),
    strategy,
    performance: score == null ? null : Math.round(score * 100),
    lab: {
      lcp: a("largest-contentful-paint"),
      cls: a("cumulative-layout-shift"),
      tbt: a("total-blocking-time"),
      fcp: a("first-contentful-paint"),
      si: a("speed-index"),
      tti: a("interactive"),
    },
    // When Google lacks page-level CrUX data it falls back to origin data; don't present that as page data.
    field: data?.loadingExperience?.origin_fallback ? null : mapField(data?.loadingExperience),
    origin: mapField(data?.originLoadingExperience),
    opportunities,
  };
}

/** PageSpeed Insights report for one URL (cached 24 h). Throws AppError when disabled or unavailable. */
export async function pageSpeed(url: string, strategy: PsiStrategy = "mobile"): Promise<Sourced<PsiReport>> {
  if (!pagespeedEnabled()) throw new AppError("PageSpeed Insights is disabled (ENABLE_PAGESPEED=false).", 503);
  return cached(`psi:v1:${strategy}:${url}`, "pagespeed", 24, () => run(url, strategy));
}
