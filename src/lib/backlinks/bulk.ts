import { hostname, safeUrl } from "@/lib/domain";
import { looseRootDomain } from "./normalize";
import { cached, demo, liveEnabled, type Sourced } from "@/lib/providers/source";
import { hash, round, unit } from "@/lib/seo/engine";
import { backlinkHeadline, linkMix, quickVelocity, sumVelocity } from "./metrics";
import * as live from "./live";
import type { BulkRow, BulkTarget, BulkInvalid } from "./types";

export const BULK_LIMIT = 200;

/** Parse the textarea: one domain, subdomain or URL per line (commas also accepted). */
export function parseTargets(text: string): { targets: BulkTarget[]; invalid: BulkInvalid[]; duplicates: number; total: number } {
  const lines = text.split(/\r?\n/);
  const targets: BulkTarget[] = [];
  const invalid: BulkInvalid[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let total = 0;
  lines.forEach((raw, i) => {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (!value) continue;
      total++;
      if (/\s/.test(value)) {
        invalid.push({ line: i + 1, value, reason: "Contains spaces" });
        continue;
      }
      const isUrl = /^https?:\/\//i.test(value) || /^[^/]+\.[^/]+\/./.test(value);
      try {
        const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        if (isUrl) safeUrl(withProto);
        const domain = looseRootDomain(withProto);
        if (!domain) throw new Error("invalid");
        const host = hostname(withProto).replace(/^www\./, "");
        let target: BulkTarget;
        if (isUrl) {
          const u = new URL(withProto);
          const path = u.pathname + u.search;
          if (path === "/" || path === "") target = { input: value, target: domain, kind: "domain", domain };
          else target = { input: value, target: `${u.hostname}${path}`.replace(/^www\./, ""), kind: "url", domain };
        } else if (host !== domain) target = { input: value, target: host, kind: "subdomain", domain };
        else target = { input: value, target: domain, kind: "domain", domain };
        if (seen.has(target.target)) {
          duplicates++;
          continue;
        }
        seen.add(target.target);
        targets.push(target);
      } catch {
        invalid.push({ line: i + 1, value, reason: /:\d+/.test(value) ? "Ports and credentials are not supported" : "Not a valid domain or URL" });
      }
    }
  });
  return { targets, invalid, duplicates, total };
}

/** Share of the root domain's link profile that a subdomain or URL receives (deterministic). */
function shareOf(t: BulkTarget) {
  if (t.kind === "domain") return 1;
  if (t.kind === "subdomain") return round(0.03 + 0.3 * unit(`bulk-sub:${t.target}`) ** 1.5, 4);
  return round(0.0008 + 0.03 * unit(`bulk-url:${t.target}`) ** 2.2, 5);
}

function demoRow(t: BulkTarget): BulkRow {
  const h = backlinkHeadline(t.domain);
  const mix = linkMix(t.domain);
  const share = shareOf(t);
  const v = sumVelocity(quickVelocity(t.domain, 30));
  const rdShare = t.kind === "domain" ? 1 : Math.min(1, share ** 0.85);
  const s = (n: number, f: number) => (t.kind === "domain" ? n : Math.round(n * f));
  return {
    target: t.target,
    kind: t.kind,
    domain: t.domain,
    authorityScore: h.authorityScore,
    referringDomains: Math.max(t.kind === "domain" ? 0 : 1, s(h.referringDomains, rdShare)),
    backlinks: Math.max(t.kind === "domain" ? 0 : 1, s(h.backlinks, share)),
    referringIps: Math.max(t.kind === "domain" ? 0 : 1, s(h.referringIps, rdShare)),
    followPct: round(mix.follow * 100, 1),
    nofollowPct: round(mix.nofollow * 100, 1),
    textPct: round(mix.text * 100, 1),
    imagePct: round(mix.image * 100, 1),
    newRd30: s(v.newRd, rdShare),
    lostRd30: s(v.lostRd, rdShare),
    newBl30: s(v.newBl, share),
    lostBl30: s(v.lostBl, share),
  };
}

async function liveRows(ownerId: string, targets: BulkTarget[]): Promise<BulkRow[]> {
  const res = await live.bulk(
    ownerId,
    targets.map((t) => t.target),
  );
  return targets.map((t) => {
    const r = res.ranks.get(t.target);
    const b = res.backlinks.get(t.target);
    const d = res.referringDomains.get(t.target);
    const bl: number | null = b?.backlinks ?? null;
    return {
      target: t.target,
      kind: t.kind,
      domain: t.domain,
      authorityScore: r?.rank != null ? Math.round(r.rank / 10) : null,
      referringDomains: d?.referring_domains ?? null,
      backlinks: bl,
      referringIps: null,
      followPct: d?.referring_domains ? round((1 - (d.referring_domains_nofollow ?? 0) / d.referring_domains) * 100, 1) : null,
      nofollowPct: d?.referring_domains ? round(((d.referring_domains_nofollow ?? 0) / d.referring_domains) * 100, 1) : null,
      textPct: null,
      imagePct: null,
      newRd30: null,
      lostRd30: null,
      newBl30: null,
      lostBl30: null,
    };
  });
}

export async function bulkAnalysis(ownerId: string, targets: BulkTarget[]): Promise<Sourced<BulkRow[]>> {
  if (liveEnabled()) return cached(`bl:bulk:${targets.length}:${hash(targets.map((t) => t.target).join("|")).toString(36)}`, "dataforseo", 24, () => liveRows(ownerId, targets));
  return demo(targets.map(demoRow));
}
