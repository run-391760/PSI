import type { OrganicInsights } from "@/lib/google/data";

/**
 * Pure mapping from organicInsights (Search Console + GA4) to the compact snapshot used on the project
 * dashboard and in Project SEO reports. Unknown values stay null (rendered "n/a").
 */
export type GoogleSnapshot = {
  range: { start: string; end: string; days: number };
  clicks: number | null;
  clicksDelta: number | null;
  impressions: number | null;
  impressionsDelta: number | null;
  ctr: number | null;
  position: number | null;
  positionDelta: number | null;
  sessions: number | null;
  sessionsDelta: number | null;
  keyEvents: number | null;
  daily: { date: string; clicks: number | null; impressions: number | null; organic: number | null }[];
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  topPages: { path: string; clicks: number | null; impressions: number | null; position: number | null; sessions: number | null }[];
  channels: { channel: string; sessions: number }[];
  errors: string[];
};

export const pctChange = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export function googleSnapshot(d: OrganicInsights): GoogleSnapshot {
  const g = d.gsc;
  const a = d.ga4;
  const days = new Map<string, GoogleSnapshot["daily"][number]>();
  for (const r of g?.daily ?? []) days.set(r.date, { date: r.date, clicks: r.clicks, impressions: r.impressions, organic: null });
  for (const r of a?.daily ?? []) {
    const row = days.get(r.date) ?? { date: r.date, clicks: null, impressions: null, organic: null };
    row.organic = r.organic;
    days.set(r.date, row);
  }
  return {
    range: { start: d.range.start, end: d.range.end, days: d.range.days },
    clicks: g ? g.totals.clicks : null,
    clicksDelta: g ? pctChange(g.totals.clicks, g.previous.clicks) : null,
    impressions: g ? g.totals.impressions : null,
    impressionsDelta: g ? pctChange(g.totals.impressions, g.previous.impressions) : null,
    ctr: g && g.totals.impressions ? g.totals.ctr : null,
    position: g && g.totals.position ? Math.round(g.totals.position * 10) / 10 : null,
    positionDelta: g && g.totals.position && g.previous.position ? pctChange(g.totals.position, g.previous.position) : null,
    sessions: a ? a.organic.sessions : null,
    sessionsDelta: a ? pctChange(a.organic.sessions, a.organicPrevious.sessions) : null,
    keyEvents: a ? a.organic.keyEvents : null,
    daily: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)),
    topQueries: [...(g?.queries ?? [])]
      .sort((x, y) => y.clicks - x.clicks || y.impressions - x.impressions)
      .slice(0, 10)
      .map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: Math.round(q.position * 10) / 10 })),
    topPages: d.pages.slice(0, 10).map((p) => ({ path: p.path, clicks: p.clicks, impressions: p.impressions, position: p.position == null ? null : Math.round(p.position * 10) / 10, sessions: p.sessions })),
    channels: (a?.channels ?? []).slice(0, 8).map((c) => ({ channel: c.channel, sessions: c.sessions })),
    errors: [d.gscError, d.ga4Error].filter((e): e is string => !!e),
  };
}
