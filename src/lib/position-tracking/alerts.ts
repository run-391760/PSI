import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { aggregateDay, type RankRow } from "./metrics";
import { ALERT_KINDS, alertKind, type AlertKind, type AlertRule, type AlertRuleInput, type Device, type Severity } from "./types";

type RuleRow = {
  id: string;
  project_id: string;
  project_name: string;
  project_domain: string;
  name: string;
  kind: AlertKind;
  threshold: number;
  device: Device | null;
  tag_id: string | null;
  tag_name: string | null;
  competitor: string | null;
  severity: Severity;
  enabled: boolean;
  last_triggered_at: string | Date | null;
  trigger_count: number;
  created_at: string | Date;
};

const SELECT = `SELECT r.*, p.name AS project_name, p.domain AS project_domain, t.name AS tag_name
  FROM pt_alert_rules r JOIN projects p ON p.id=r.project_id LEFT JOIN pt_tags t ON t.id=r.tag_id`;

function toRule(r: RuleRow): AlertRule {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectDomain: r.project_domain,
    name: r.name,
    kind: r.kind,
    threshold: Number(r.threshold),
    device: r.device,
    tagId: r.tag_id,
    tagName: r.tag_name,
    competitor: r.competitor,
    severity: r.severity,
    enabled: r.enabled,
    lastTriggeredAt: r.last_triggered_at ? new Date(r.last_triggered_at).toISOString() : null,
    triggerCount: r.trigger_count,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listRules(ownerId: string, projectId?: string) {
  const rows = await query<RuleRow>(`${SELECT} WHERE r.owner_id=$1 AND ($2::text IS NULL OR r.project_id=$2) ORDER BY p.name, r.created_at`, [ownerId, projectId ?? null]);
  return rows.map(toRule);
}

async function validate(ownerId: string, input: AlertRuleInput) {
  const [project] = await query<{ id: string; domain: string }>("SELECT id, domain FROM projects WHERE id=$1 AND owner_id=$2", [input.projectId, ownerId]);
  if (!project) throw new AppError("Project not found.", 404);
  const [campaign] = await query<{ competitors: string[] }>("SELECT competitors FROM pt_campaigns WHERE project_id=$1", [input.projectId]);
  if (!campaign) throw new AppError("Set up Position Tracking for this project before adding alert rules.");
  if (!ALERT_KINDS.some((k) => k.id === input.kind)) throw new AppError("Choose a trigger.");
  const name = input.name.trim().slice(0, 80) || alertKind(input.kind).describe(input.threshold, input.competitor);
  const threshold = Number(input.threshold);
  if (input.kind !== "overtaken") {
    if (!Number.isFinite(threshold) || threshold <= 0) throw new AppError("Enter a threshold greater than 0.");
    if ((input.kind === "enter_top" || input.kind === "leave_top") && (threshold > 100 || !Number.isInteger(threshold))) throw new AppError("Top N must be a whole number from 1 to 100.");
    if ((input.kind === "drop" || input.kind === "rise") && (threshold > 99 || !Number.isInteger(threshold))) throw new AppError("Position change must be a whole number from 1 to 99.");
    if (input.kind === "visibility_change" && threshold > 1000) throw new AppError("Visibility change must be at most 1000%.");
  }
  if (input.device && !["desktop", "mobile"].includes(input.device)) throw new AppError("Invalid device.");
  if (!["info", "success", "warning", "critical"].includes(input.severity)) throw new AppError("Invalid severity.");
  if (input.tagId) {
    const [tag] = await query("SELECT id FROM pt_tags WHERE id=$1 AND project_id=$2", [input.tagId, input.projectId]);
    if (!tag) throw new AppError("That tag does not belong to the project.");
  }
  const competitor = input.kind === "overtaken" && input.competitor ? input.competitor : null;
  if (competitor && !campaign.competitors.includes(competitor)) throw new AppError("Choose one of the tracked competitors.");
  return { name, threshold: input.kind === "overtaken" ? 0 : threshold, competitor };
}

export async function createRule(ownerId: string, input: AlertRuleInput) {
  const v = await validate(ownerId, input);
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM pt_alert_rules WHERE project_id=$1", [input.projectId]);
  if (n >= 50) throw new AppError("A project can have at most 50 alert rules.");
  const id = randomUUID();
  await query(
    `INSERT INTO pt_alert_rules(id,project_id,owner_id,name,kind,threshold,device,tag_id,competitor,severity,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, input.projectId, ownerId, v.name, input.kind, v.threshold, input.device, input.tagId, v.competitor, input.severity, input.enabled],
  );
  return id;
}

export async function updateRule(ownerId: string, id: string, input: AlertRuleInput) {
  const [existing] = await query<{ project_id: string }>("SELECT project_id FROM pt_alert_rules WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!existing) throw new AppError("Alert rule not found.", 404);
  const v = await validate(ownerId, input);
  await query(
    `UPDATE pt_alert_rules SET project_id=$3,name=$4,kind=$5,threshold=$6,device=$7,tag_id=$8,competitor=$9,severity=$10,enabled=$11,
       last_eval_day=CASE WHEN kind=$5 AND threshold=$6 THEN last_eval_day ELSE NULL END WHERE id=$1 AND owner_id=$2`,
    [id, ownerId, input.projectId, v.name, input.kind, v.threshold, input.device, input.tagId, v.competitor, input.severity, input.enabled],
  );
}

export async function setRuleEnabled(ownerId: string, id: string, enabled: boolean) {
  const res = await query("UPDATE pt_alert_rules SET enabled=$3 WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId, enabled]);
  if (!res.length) throw new AppError("Alert rule not found.", 404);
}

export async function deleteRule(ownerId: string, id: string) {
  const res = await query("DELETE FROM pt_alert_rules WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId]);
  if (!res.length) throw new AppError("Alert rule not found.", 404);
}

// ------------------------------------------------------------------------------------ Evaluation

type Hit = { keywordId: string | null; device: Device; title: string; body: string };
const r1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number) => (n === 1 ? "" : "s");
const MAX_PER_RULE = 10;

/**
 * Compares the given day with the previous stored day (per device) and raises notifications for every
 * enabled rule. Each rule is evaluated at most once per day so repeated "Update now" clicks do not spam.
 */
export async function evaluateAlerts(project: { id: string; owner_id: string; domain: string; name: string }, day: string) {
  const rules = await query<RuleRow>(`${SELECT} WHERE r.project_id=$1 AND r.enabled AND (r.last_eval_day IS NULL OR r.last_eval_day<$2)`, [project.id, day]);
  if (!rules.length) return 0;
  const [campaign] = await query<{ device: string; competitors: string[]; source: string }>("SELECT device, competitors, source FROM pt_campaigns WHERE project_id=$1", [project.id]);
  if (!campaign) return 0;
  // Search Console: average positions of the own site; no impressions = no position. No competitor data.
  const gsc = campaign.source === "search-console";
  const fmt = (p: number | null | undefined) => (p == null ? (gsc ? "no impressions" : ">100") : `#${r1(p)}`);
  const outOf = gsc ? "out of Search Console results (no impressions)" : "out of the top 100";
  const devices: Device[] = campaign.device === "both" ? ["desktop", "mobile"] : [campaign.device as Device];
  const keywords = await query<{ id: string; keyword: string; volume: number | null }>("SELECT id, keyword, volume FROM pt_keywords WHERE project_id=$1", [project.id]);
  const kwName = new Map(keywords.map((k) => [k.id, k.keyword]));
  const volumes = new Map(keywords.map((k) => [k.id, k.volume]));
  const tagLinks = await query<{ keyword_id: string; tag_id: string }>(
    "SELECT kt.keyword_id, kt.tag_id FROM pt_keyword_tags kt JOIN pt_tags t ON t.id=kt.tag_id WHERE t.project_id=$1",
    [project.id],
  );

  const snapshots = new Map<Device, { prevDay: string; cur: Map<string, RankRow>; prev: Map<string, RankRow> } | null>();
  for (const device of devices) {
    const [p] = await query<{ day: string | null }>("SELECT max(day) AS day FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day<$3", [project.id, device, day]);
    if (!p?.day) {
      snapshots.set(device, null);
      continue;
    }
    const rows = await query<RankRow>("SELECT keyword_id, day, positions, features, clicks, impressions FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day IN ($3,$4)", [project.id, device, day, p.day]);
    snapshots.set(device, {
      prevDay: p.day,
      cur: new Map(rows.filter((r) => r.day === day).map((r) => [r.keyword_id, r])),
      prev: new Map(rows.filter((r) => r.day === p.day).map((r) => [r.keyword_id, r])),
    });
  }

  const own = project.domain;
  const { notify } = await import("@/lib/jobs/queue");
  let sent = 0;
  for (const rule of rules) {
    const inTag = rule.tag_id ? new Set(tagLinks.filter((l) => l.tag_id === rule.tag_id).map((l) => l.keyword_id)) : null;
    const hits: Hit[] = [];
    for (const device of rule.device ? devices.filter((d) => d === rule.device) : devices) {
      const snap = snapshots.get(device);
      if (!snap) continue;
      const devLabel = device === "mobile" ? "Mobile" : "Desktop";
      if (rule.kind === "visibility_change") {
        const pick = (m: Map<string, RankRow>) => [...m.values()].filter((r) => kwName.has(r.keyword_id) && (!inTag || inTag.has(r.keyword_id)));
        const [cur] = aggregateDay(day, pick(snap.cur), [own], volumes, { measured: gsc });
        const [prev] = aggregateDay(snap.prevDay, pick(snap.prev), [own], volumes, { measured: gsc });
        if (!prev || prev.visibility <= 0) continue;
        const change = ((cur.visibility - prev.visibility) / prev.visibility) * 100;
        if (Math.abs(change) >= rule.threshold)
          hits.push({
            keywordId: null,
            device,
            title: `Visibility ${change > 0 ? "rose" : "fell"} ${Math.abs(change).toFixed(1)}% for ${own}`,
            body: `${prev.visibility.toFixed(2)}% → ${cur.visibility.toFixed(2)}% · ${devLabel}${rule.tag_name ? ` · tag “${rule.tag_name}”` : ""} · ${project.name}`,
          });
        continue;
      }
      for (const [keywordId, cur] of snap.cur) {
        if (!kwName.has(keywordId) || (inTag && !inTag.has(keywordId))) continue;
        const prev = snap.prev.get(keywordId);
        if (!prev) continue;
        const kw = kwName.get(keywordId)!;
        const a = prev.positions[own] ?? null;
        const b = cur.positions[own] ?? null;
        const n = rule.threshold;
        // Search Console: a day without impressions is "no data", not a ranking loss — compare measured days only.
        if (gsc && (a == null || b == null)) continue;
        const suffix = `${devLabel} · ${project.name}`;
        if (rule.kind === "enter_top" && b != null && b <= n && (a == null || a > n)) hits.push({ keywordId, device, title: `“${kw}” entered the top ${n}`, body: `${fmt(a)} → ${fmt(b)} · ${suffix}` });
        else if (rule.kind === "leave_top" && a != null && a <= n && (b == null || b > n)) hits.push({ keywordId, device, title: `“${kw}” dropped out of the top ${n}`, body: `${fmt(a)} → ${fmt(b)} · ${suffix}` });
        else if (rule.kind === "drop" && (b ?? 101) - (a ?? 101) >= n && a != null) hits.push({ keywordId, device, title: `“${kw}” dropped ${b == null ? outOf : `${r1(b - a)} position${plural(r1(b - a))}`}`, body: `${fmt(a)} → ${fmt(b)} · ${suffix}` });
        else if (rule.kind === "rise" && (a ?? 101) - (b ?? 101) >= n && b != null) hits.push({ keywordId, device, title: a == null ? `“${kw}” started ranking at ${fmt(b)}` : `“${kw}” improved ${r1(a - b)} position${plural(r1(a - b))}`, body: `${fmt(a)} → ${fmt(b)} · ${suffix}` });
        else if (rule.kind === "overtaken" && !gsc) {
          const comps = rule.competitor ? [rule.competitor] : campaign.competitors;
          for (const c of comps) {
            const ca = prev.positions[c] ?? null;
            const cb = cur.positions[c] ?? null;
            const wasAhead = a != null && (ca == null || a < ca);
            const nowBehind = cb != null && (b == null || cb < b);
            if (wasAhead && nowBehind) {
              hits.push({ keywordId, device, title: `${c} overtook you for “${kw}”`, body: `${c} ${fmt(cb)} vs you ${fmt(b)} (was ${fmt(ca)} vs ${fmt(a)}) · ${suffix}` });
              break;
            }
          }
        }
      }
    }
    const link = (h: Hit) => `/position-tracking?project=${project.id}&tab=overview&device=${h.device}${h.keywordId ? `&kw=${h.keywordId}` : ""}`;
    for (const h of hits.slice(0, MAX_PER_RULE))
      await notify({ ownerId: project.owner_id, projectId: project.id, tool: "position-tracking", severity: rule.severity, title: h.title, body: `${h.body} · Rule “${rule.name}”`, link: h.keywordId ? link(h) : `/position-tracking?project=${project.id}&tab=landscape&device=${h.device}` });
    if (hits.length > MAX_PER_RULE)
      await notify({
        ownerId: project.owner_id,
        projectId: project.id,
        tool: "position-tracking",
        severity: rule.severity,
        title: `${hits.length - MAX_PER_RULE} more keywords matched “${rule.name}”`,
        body: `${project.name} · ${day}`,
        link: `/position-tracking?project=${project.id}&tab=overview`,
      });
    sent += Math.min(hits.length, MAX_PER_RULE + 1);
    await query(
      `UPDATE pt_alert_rules SET last_eval_day=$2, trigger_count=trigger_count+$3, last_triggered_at=CASE WHEN $3>0 THEN now() ELSE last_triggered_at END WHERE id=$1`,
      [rule.id, day, hits.length],
    );
  }
  return sent;
}

/** Projects with a tracking campaign, with what the rule form needs (competitors, tags, devices). */
export async function ruleProjects(ownerId: string, projectId?: string) {
  const rows = await query<{ id: string; name: string; domain: string; competitors: string[]; device: string; tags: { id: string; name: string }[] }>(
    `SELECT p.id, p.name, p.domain, c.competitors, c.device,
       COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name) ORDER BY t.name) FROM pt_tags t WHERE t.project_id=p.id), '[]'::json) AS tags
     FROM projects p JOIN pt_campaigns c ON c.project_id=p.id WHERE p.owner_id=$1 AND ($2::text IS NULL OR p.id=$2) ORDER BY p.name`,
    [ownerId, projectId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    competitors: r.competitors ?? [],
    tags: r.tags ?? [],
    devices: (r.device === "both" ? ["desktop", "mobile"] : [r.device]) as Device[],
  }));
}
