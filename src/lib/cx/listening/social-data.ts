import { query } from "@/lib/db";
import { googleConfigured } from "@/lib/google/oauth";
import { ga4Report, getProjectGoogle, type Ga4Row } from "@/lib/google/data";
import { cached } from "@/lib/providers/source";
import type { InsightResult } from "@/lib/cx/publishing/dispatch";
import { bestTimes, engagementRate, parseFormula, tagPerformance, type ErFormula, type ErMetric } from "./social";

/** Server side of social analytics built on our own records (posts, link clicks, channel API snapshots). */

export async function getFormula(projectId: string): Promise<ErFormula> {
  const [r] = await query<{ er_formula: unknown }>("SELECT er_formula FROM cx_listening_settings WHERE project_id=$1", [projectId]);
  return parseFormula(r?.er_formula);
}

export async function saveFormula(projectId: string, f: ErFormula) {
  const clean = parseFormula(f);
  await query("INSERT INTO cx_listening_settings(project_id, er_formula) VALUES($1,$2::jsonb) ON CONFLICT(project_id) DO UPDATE SET er_formula=$2::jsonb", [projectId, JSON.stringify(clean)]);
  return clean;
}

export type ScoredPost = { kind: string; id: string; title: string; url: string | null; at: string | null; likes: number | null; comments: number | null; shares: number | null; views: number | null; engagements: number | null; rate: number | null };

/** Recent posts reported by connected channel APIs, scored with the brand's formula. */
export function scorePosts(insights: InsightResult[], f: ErFormula): ScoredPost[] {
  return insights.flatMap((i) =>
    (i.stats?.recent ?? []).map((r) => {
      const m = { likes: r.likes, comments: r.comments, shares: r.shares, views: r.views };
      const eng = (["likes", "comments", "shares", "views"] as ErMetric[]).some((k) => f.weights[k] && m[k] != null) ? engagementRate(m, { ...f, denominator: "none" }, null) : null;
      return { kind: i.kind, id: r.id, title: r.title, url: r.url, at: r.at, ...m, engagements: eng, rate: f.denominator === "none" ? null : engagementRate(m, f, i.stats?.followers ?? null) };
    }),
  );
}

/** Best-time suggestions from (a) engagement on connected channels' recent posts and (b) human short-link clicks. */
export async function suggestionInputs(projectId: string, scored: ScoredPost[], days = 90) {
  const clicks = await query<{ at: string | Date }>(
    "SELECT k.clicked_at at FROM cx_pub_clicks k JOIN cx_pub_links l ON l.id=k.link_id WHERE l.project_id=$1 AND k.device<>'bot' AND k.clicked_at > now() - ($2 * interval '1 day') LIMIT 20000",
    [projectId, days],
  );
  return {
    engagement: bestTimes(scored.filter((p) => p.engagements != null).map((p) => ({ at: p.at, weight: p.engagements ?? 0 }))),
    clicks: bestTimes(clicks.map((c) => ({ at: new Date(c.at).toISOString(), weight: 1 }))),
  };
}

/** Previous-period daily clicks aligned with the current period (for the comparison series). */
export async function prevClickSeries(projectId: string, days: number) {
  const rows = await query<{ day: string; clicks: number }>(
    `SELECT to_char(date_trunc('day',k.clicked_at),'YYYY-MM-DD') AS day, count(*)::int clicks FROM cx_pub_clicks k JOIN cx_pub_links l ON l.id=k.link_id
     WHERE l.project_id=$1 AND k.device<>'bot' AND k.clicked_at <= now() - ($2 * interval '1 day') AND k.clicked_at > now() - ($2 * 2 * interval '1 day') GROUP BY 1`,
    [projectId, days],
  );
  const map = new Map(rows.map((r) => [r.day, r.clicks]));
  return Array.from({ length: days }, (_, i) => map.get(new Date(Date.now() - (2 * days - 1 - i) * 86400000).toISOString().slice(0, 10)) ?? 0);
}

/** Content tags (campaigns) performance: posts published, link clicks, engagement from matched channel posts. */
export async function contentTags(projectId: string, days: number, scored: ScoredPost[]) {
  const [tags, posts] = await Promise.all([
    query<{ id: string; name: string }>("SELECT id, name FROM cx_pub_campaigns WHERE project_id=$1", [projectId]),
    query<{ id: string; campaign_id: string | null; channels: string[]; published_at: string | Date | null; results: Record<string, { externalId?: string; status: string }>; clicks: number }>(
      `SELECT p.id, p.campaign_id, p.channels, p.published_at, p.results,
         (SELECT count(*)::int FROM cx_pub_clicks k JOIN cx_pub_links l ON l.id=k.link_id WHERE l.post_id=p.id AND k.device<>'bot') clicks
       FROM cx_pub_posts p WHERE p.project_id=$1 AND p.status='published' AND p.published_at > now() - ($2 * 2 * interval '1 day')`,
      [projectId, days],
    ),
  ]);
  const byExt = new Map(scored.map((s) => [`${s.kind}:${s.id}`, s]));
  const rows = posts.map((p) => {
    const matched = Object.entries(p.results ?? {}).flatMap(([k, r]) => (r?.externalId && byExt.get(`${k}:${r.externalId}`) ? [byExt.get(`${k}:${r.externalId}`)!] : []));
    const engs = matched.filter((m) => m.engagements != null);
    const rates = matched.filter((m) => m.rate != null);
    return {
      campaign_id: p.campaign_id,
      channels: p.channels,
      published_at: p.published_at ? new Date(p.published_at).toISOString() : null,
      clicks: p.clicks,
      engagements: engs.length ? engs.reduce((a, m) => a + (m.engagements ?? 0), 0) : null,
      rate: rates.length ? rates.reduce((a, m) => a + (m.rate ?? 0), 0) / rates.length : null,
    };
  });
  const now = Date.now();
  return { rows: tagPerformance(rows, tags, new Date(now - days * 86400000), new Date(now - 2 * days * 86400000)), tags: tags.length };
}

// ------------------------------------------------------------------ GA4 (3P adapter)

export type Ga4Audience = { property: string; byCountry: { label: string; users: number }[]; byCity: { label: string; users: number }[]; byLanguage: { label: string; users: number }[]; byDevice: { label: string; users: number }[]; byChannel: { label: string; users: number }[] };

/** Map GA4 runReport rows (one dimension, activeUsers) to labelled counts. */
export function mapGa4Dim(rows: Ga4Row[], limit = 8) {
  return rows
    .map((r) => ({ label: r.dimensionValues?.[0]?.value || "(not set)", users: Number(r.metricValues?.[0]?.value ?? 0) || 0 }))
    .sort((a, b) => b.users - a.users)
    .slice(0, limit);
}

export async function ga4Audience(ownerId: string, projectId: string, days: number): Promise<{ state: "not-configured" } | { state: "not-linked" } | { state: "ok"; data: Ga4Audience; fetchedAt: string } | { state: "error"; error: string }> {
  if (!googleConfigured()) return { state: "not-configured" };
  const link = await getProjectGoogle(projectId);
  if (!link.ga4Property) return { state: "not-linked" };
  const property = link.ga4Property;
  try {
    const r = await cached(`cx-ga4-audience:${property}:${days}`, "google-analytics", 6, async () => {
      const dim = async (name: string) =>
        mapGa4Dim(await ga4Report(ownerId, property, { dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }], dimensions: [{ name }], metrics: [{ name: "activeUsers" }], limit: 25 }));
      // Sequential on purpose: GA4 limits concurrent requests per property.
      const byCountry = await dim("country");
      const byCity = await dim("city");
      const byLanguage = await dim("language");
      const byDevice = await dim("deviceCategory");
      const byChannel = await dim("sessionDefaultChannelGroup");
      return { property, byCountry, byCity, byLanguage, byDevice, byChannel };
    });
    return { state: "ok", data: r.data, fetchedAt: r.fetchedAt };
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
