import { AppError } from "@/lib/domain";
import { pageSpeed, pagespeedEnabled, type PsiReport } from "@/lib/providers/pagespeed";
import { cwvStatus } from "./checks";
import type { CwvSummary, PsiMetric, PsiPage } from "./types";

const metric = (key: Parameters<typeof cwvStatus>[0], value: number | null): PsiMetric => ({ value, status: cwvStatus(key, value) });

function toPage(r: PsiReport, fetchedAt: string): PsiPage {
  return {
    url: r.url,
    strategy: r.strategy,
    ok: true,
    score: r.performance,
    lab: { lcp: metric("lcp", r.lab.lcp), cls: metric("cls", r.lab.cls), tbt: metric("tbt", r.lab.tbt), fcp: metric("fcp", r.lab.fcp), si: metric("si", r.lab.si) },
    field: r.field
      ? { lcp: metric("lcp", r.field.lcp), inp: metric("inp", r.field.inp), cls: metric("cls", r.field.cls), fcp: metric("fcp", r.field.fcp), ttfb: metric("ttfb", r.field.ttfb), overall: r.field.overall }
      : null,
    origin: r.origin ? { lcp: metric("lcp", r.origin.lcp), inp: metric("inp", r.origin.inp), cls: metric("cls", r.origin.cls), overall: r.origin.overall } : null,
    fetchedAt,
  };
}
const emptyLab = { lcp: metric("lcp", null), cls: metric("cls", null), tbt: metric("tbt", null), fcp: metric("fcp", null), si: metric("si", null) };

/**
 * Measures Core Web Vitals with PageSpeed Insights for up to 6 URLs (2 in parallel). Stops early on
 * quota/availability errors so we don't hammer the API; never throws.
 */
export async function measureCwv(urls: string[], strategy: "mobile" | "desktop", onStep?: (done: number, total: number) => Promise<void>): Promise<CwvSummary> {
  const measuredAt = new Date().toISOString();
  if (!pagespeedEnabled()) return { status: "disabled", note: "PageSpeed Insights is disabled (ENABLE_PAGESPEED=false).", strategy, pages: [], measuredAt };
  const targets = [...new Set(urls)].slice(0, 6);
  const pages: PsiPage[] = [];
  let fatal: string | null = null;
  let i = 0;
  let done = 0;
  const run = async () => {
    while (i < targets.length) {
      const url = targets[i++];
      if (fatal) {
        pages.push({ url, strategy, ok: false, error: fatal, score: null, lab: emptyLab, field: null, origin: null, fetchedAt: measuredAt });
        continue;
      }
      try {
        const r = await pageSpeed(url, strategy);
        pages.push({ ...toPage(r.data, r.fetchedAt), url });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "PageSpeed Insights failed.";
        if (e instanceof AppError && [429, 503, 504].includes(e.status)) fatal = msg;
        pages.push({ url, strategy, ok: false, error: msg, score: null, lab: emptyLab, field: null, origin: null, fetchedAt: measuredAt });
      }
      done++;
      await onStep?.(done, targets.length);
    }
  };
  await Promise.all([run(), run()]);
  pages.sort((a, b) => targets.indexOf(a.url) - targets.indexOf(b.url));
  const ok = pages.filter((p) => p.ok).length;
  return {
    status: ok === pages.length && ok ? "ok" : ok ? "partial" : "unavailable",
    note: ok === pages.length ? null : (pages.find((p) => !p.ok)?.error ?? null),
    strategy,
    pages,
    measuredAt,
  };
}
