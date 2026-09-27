/** Client-safe PPC planner model: types, auto-grouping, cross-group negatives, CTR model, Ads Editor CSV. */
import { kwTokens, normalizeKw, stem, STOPWORDS, titleCase } from "./text";

export type AdMatch = "broad" | "phrase" | "exact";
export const AD_MATCHES: { id: AdMatch; label: string; example: (k: string) => string; reach: number }[] = [
  { id: "broad", label: "Broad", example: (k) => k, reach: 1.5 },
  { id: "phrase", label: "Phrase", example: (k) => `"${k}"`, reach: 1.25 },
  { id: "exact", label: "Exact", example: (k) => `[${k}]`, reach: 1 },
];

export type PpcKeyword = { id: string; groupId: string; keyword: string; match: AdMatch; volume: number | null; cpc: number | null; competition: number | null; source: string };
export type PpcNegative = { id: string; groupId: string | null; keyword: string; match: AdMatch; origin: "manual" | "cross-group" };
export type PpcGroup = { id: string; name: string; keywords: PpcKeyword[]; negatives: PpcNegative[] };
export type PpcCampaign = { id: string; name: string; db: string; ctr: number; created_at: string; updated_at: string };
export type PpcCampaignSummary = PpcCampaign & { groups: number; keywords: number; volume: number | null };
export type CampaignDetail = { campaign: PpcCampaign; groups: PpcGroup[]; campaignNegatives: PpcNegative[] };

const reach = (m: AdMatch) => AD_MATCHES.find((x) => x.id === m)?.reach ?? 1;

/** Simple planning model: clicks = volume × CTR × match-type reach; cost = clicks × CPC. */
export function estimate(k: Pick<PpcKeyword, "volume" | "cpc" | "match">, ctr: number) {
  const clicks = k.volume == null ? null : k.volume * ctr * reach(k.match);
  const cost = clicks == null || k.cpc == null ? null : clicks * k.cpc;
  return { clicks, cost };
}

/**
 * Totals of an ad group / campaign. Volume, clicks and cost are null ("n/a") when no keyword has the
 * metric: without a keyword data provider nothing is estimated.
 */
export function groupTotals(keywords: PpcKeyword[], ctr: number) {
  let volume = 0,
    clicks = 0,
    cost = 0,
    cpcSum = 0,
    cpcN = 0,
    volN = 0,
    costN = 0;
  for (const k of keywords) {
    if (k.volume != null) volN++;
    volume += k.volume ?? 0;
    const e = estimate(k, ctr);
    clicks += e.clicks ?? 0;
    if (e.cost != null) costN++;
    cost += e.cost ?? 0;
    if (k.cpc != null) {
      cpcSum += k.cpc;
      cpcN++;
    }
  }
  return {
    keywords: keywords.length,
    volume: volN ? volume : null,
    clicks: volN ? Math.round(clicks) : null,
    cost: costN ? Math.round(cost * 100) / 100 : null,
    avgCpc: cpcN ? cpcSum / cpcN : null,
    /** Keywords with a measured volume (the rest are n/a). */
    measured: volN,
  };
}

const meaningful = (k: string) => [...new Set(kwTokens(k).filter((t) => !STOPWORDS.has(t) && t.length > 1).map(stem))];

/** "small business" instead of "business" when every member has the same neighbouring word. */
function phraseName(members: string[], st: string, common: Set<string>) {
  const lists = members.map((k) => kwTokens(k));
  const at = lists.map((l) => l.findIndex((w) => stem(w) === st));
  if (at.some((i) => i < 0)) return null;
  let from = 0,
    to = 0;
  const same = (off: number) => {
    const w = lists[0][at[0] + off];
    return !!w && !STOPWORDS.has(w) && !common.has(stem(w)) && lists.every((l, j) => l[at[j] + off] === w);
  };
  while (from > -2 && same(from - 1)) from--;
  while (to < 2 && same(to + 1)) to++;
  return from === 0 && to === 0 ? null : lists[0].slice(at[0] + from, at[0] + to + 1).join(" ");
}

/**
 * Groups keywords by shared words (ignoring words most keywords contain, such as the seed). Each keyword
 * joins its most specific shared word; every group has ≥2 keywords; the rest go to a general group.
 */
export function autoGroup(keywordsInput: string[], maxGroups = 40): { name: string; keywords: string[] }[] {
  const keywords = [...new Set(keywordsInput.map(normalizeKw).filter(Boolean))];
  if (keywords.length <= 2) return keywords.length ? [{ name: "General", keywords }] : [];
  const toks = keywords.map(meaningful);
  const freq = new Map<string, number>();
  const forms = new Map<string, Map<string, number>>();
  keywords.forEach((k, i) => {
    for (const t of toks[i]) freq.set(t, (freq.get(t) ?? 0) + 1);
    for (const raw of kwTokens(k)) {
      const st = stem(raw);
      const m = forms.get(st) ?? new Map();
      m.set(raw, (m.get(raw) ?? 0) + 1);
      forms.set(st, m);
    }
  });
  const common = new Set([...freq.entries()].filter(([, n]) => n / keywords.length > 0.6).map(([t]) => t));
  const label = (st: string) => [...(forms.get(st)?.entries() ?? [[st, 1]])].sort((a, b) => b[1] - a[1])[0][0];
  const candidate = (t: string) => (freq.get(t) ?? 0) >= 2 && !common.has(t) && !/^\d+$/.test(t);
  // Each keyword goes to its most specific shared word (lowest frequency, then alphabetical): tight themes.
  const pick = (i: number, allowed: (t: string) => boolean) =>
    toks[i].filter((t) => candidate(t) && allowed(t)).sort((a, b) => (freq.get(a) ?? 0) - (freq.get(b) ?? 0) || a.localeCompare(b))[0];
  const tentative = new Map<string, number[]>();
  keywords.forEach((_, i) => {
    const t = pick(i, () => true);
    if (t) tentative.set(t, [...(tentative.get(t) ?? []), i]);
  });
  const kept = new Map([...tentative.entries()].filter(([, m]) => m.length >= 2));
  // Keywords whose word formed no group join the largest kept group of another of their words.
  for (const [t, m] of tentative) {
    if (kept.has(t)) continue;
    for (const i of m) {
      const alt = toks[i].filter((x) => kept.has(x)).sort((a, b) => kept.get(b)!.length - kept.get(a)!.length)[0];
      if (alt) kept.get(alt)!.push(i);
    }
  }
  const assigned = new Set<number>();
  const groups: { name: string; keywords: string[] }[] = [];
  for (const [t, m] of [...kept.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, maxGroups)) {
    m.forEach((i) => assigned.add(i));
    groups.push({ name: titleCase(phraseName(m.map((i) => keywords[i]), t, common) ?? label(t)), keywords: m.map((i) => keywords[i]) });
  }
  const rest = keywords.filter((_, i) => !assigned.has(i));
  if (rest.length) groups.push({ name: common.size ? `${titleCase([...common].map(label).join(" "))} (general)` : "General", keywords: rest });
  return groups;
}

/**
 * Cross-group negatives: when a keyword in group B contains every word of a keyword in group A (it is
 * more specific), add it to A as a negative exact match so the query is routed to B's more relevant ad.
 */
export function crossGroupNegatives(groups: PpcGroup[], perGroupLimit = 200) {
  const out: { groupId: string; keyword: string; match: AdMatch }[] = [];
  const tok = new Map<string, Set<string>>();
  const t = (k: string) => {
    let s = tok.get(k);
    if (!s) tok.set(k, (s = new Set(kwTokens(k).map(stem))));
    return s;
  };
  for (const a of groups) {
    const own = new Set(a.keywords.map((k) => k.keyword));
    const added = new Set<string>();
    for (const ka of a.keywords) {
      const ta = t(ka.keyword);
      for (const b of groups) {
        if (b.id === a.id) continue;
        for (const kb of b.keywords) {
          if (own.has(kb.keyword) || added.has(kb.keyword) || added.size >= perGroupLimit) continue;
          const tb = t(kb.keyword);
          if (tb.size > ta.size && [...ta].every((x) => tb.has(x))) {
            added.add(kb.keyword);
            out.push({ groupId: a.id, keyword: kb.keyword, match: "exact" });
          }
        }
      }
    }
  }
  return out;
}

/** Rows for a Google Ads Editor import (Keywords and negative keywords). */
export function adsEditorRows(d: CampaignDetail) {
  const type = (m: AdMatch, negative = false, campaign = false) => `${campaign ? "Campaign " : ""}${negative ? "Negative " : ""}${m[0].toUpperCase()}${m.slice(1)}`;
  const rows: (string | number | null)[][] = [["Campaign", "Ad Group", "Keyword", "Criterion Type", "Max CPC", "Status"]];
  for (const g of d.groups) {
    for (const k of g.keywords) rows.push([d.campaign.name, g.name, k.keyword, type(k.match), k.cpc == null ? "" : k.cpc.toFixed(2), "Enabled"]);
    for (const n of g.negatives) rows.push([d.campaign.name, g.name, n.keyword, type(n.match, true), "", "Enabled"]);
  }
  for (const n of d.campaignNegatives) rows.push([d.campaign.name, "", n.keyword, type(n.match, true, true), "", "Enabled"]);
  return rows;
}
