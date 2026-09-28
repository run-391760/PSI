import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { notify } from "@/lib/jobs/queue";
import type { Project } from "@/lib/projects";
import { getSettings, listTopics, type Mention } from "./data";
import { bucketize, detectSpike, type Bucket, type SpikeResult } from "./spikes";

/** Crisis management: spike detection over stored mentions, crisis events, timeline and notes. */

export type CrisisEvent = {
  id: string;
  project_id: string;
  topic_id: string | null;
  topic_name: string | null;
  scope_key: string;
  title: string;
  kind: "volume" | "negative" | "both";
  severity: "warning" | "critical";
  status: "open" | "monitoring" | "resolved";
  owner: string;
  metrics: SpikeResult;
  window_start: string;
  window_end: string;
  peak_z: number;
  detected_at: string;
  updated_at: string;
  resolved_at: string | null;
  mentions: number;
  negative: number;
};
export type CrisisNote = { id: string; author_name: string; kind: "note" | "status" | "system"; body: string; created_at: string };
export type ScopeResult = { key: string; name: string; topicId: string | null; result: SpikeResult };

type Row = { id: string; topic_id: string | null; published_at: string | null; sentiment: string | null };

/**
 * Coverage start per topic: sources return only their latest N results, so history before a source's
 * earliest stored mention is incomplete. A scope's baseline starts at the latest of its sources'
 * earliest mentions, so a first fetch never looks like a spike against an empty past.
 */
async function coverage(projectId: string) {
  const rows = await query<{ topic_id: string | null; t: string | Date }>("SELECT topic_id, min(published_at) t FROM cx_mentions WHERE project_id=$1 AND published_at IS NOT NULL GROUP BY topic_id, source", [projectId]);
  const byTopic = new Map<string, number>();
  for (const r of rows) {
    const k = r.topic_id ?? "";
    byTopic.set(k, Math.max(byTopic.get(k) ?? 0, new Date(r.t).getTime()));
  }
  return (topicIds: string[]) => {
    const ts = topicIds.map((id) => byTopic.get(id)).filter((v): v is number => v != null);
    return ts.length ? new Date(Math.max(...ts)) : null;
  };
}

/** Run spike detection for a brand; opens/updates crisis events and sends alerts. */
export async function runDetection(project: Project) {
  const s = await getSettings(project.id);
  const topics = (await listTopics(project.id)).filter((t) => t.active);
  const baselineWindows = Math.round((s.baselineDays * 24) / s.windowHours);
  const now = new Date();
  const since = new Date(now.getTime() - (baselineWindows + 1) * s.windowHours * 3600_000);
  const rows = await query<Row>("SELECT id, topic_id, published_at, sentiment FROM cx_mentions WHERE project_id=$1 AND published_at > $2 AND published_at <= now() AND status <> 'ignored'", [project.id, since.toISOString()]);
  const since_ = await coverage(project.id);
  const scopes: { key: string; name: string; topicId: string | null; rows: Row[] }[] = topics.map((t) => ({ key: `topic:${t.id}`, name: t.name, topicId: t.id, rows: rows.filter((r) => r.topic_id === t.id) }));
  if (topics.length > 1) scopes.unshift({ key: "all", name: "All topics", topicId: null, rows });

  const results: ScopeResult[] = [];
  const opened: string[] = [];
  for (const sc of scopes) {
    const buckets = bucketize(sc.rows, now, s.windowHours, baselineWindows, since_(sc.topicId ? [sc.topicId] : topics.map((t) => t.id)));
    const result = detectSpike(buckets, s);
    results.push({ key: sc.key, name: sc.name, topicId: sc.topicId, result });
    if (!result.triggered || !result.kind || !result.severity) continue;
    const winStart = new Date(result.window.start).getTime();
    const inWindow = sc.rows.filter((r) => r.published_at && new Date(r.published_at).getTime() > winStart);
    const link = inWindow.filter((r) => result.kind !== "negative" || r.sentiment === "negative");
    const z = Math.max(result.volume.triggered ? result.volume.z : 0, result.negative.triggered ? result.negative.z : 0);
    const [existing] = await query<{ id: string; severity: string; peak_z: number }>("SELECT id, severity, peak_z FROM cx_crisis_events WHERE project_id=$1 AND scope_key=$2 AND status<>'resolved' ORDER BY detected_at DESC LIMIT 1", [project.id, sc.key]);
    let id = existing?.id;
    const what = result.kind === "negative" ? "negative mentions" : result.kind === "both" ? "mentions and negative sentiment" : "mention volume";
    const title = `Spike in ${what}: ${sc.name}`;
    const detail = `${result.volume.value} mentions (baseline ${result.volume.mean.toFixed(1)}, z ${result.volume.z.toFixed(1)}), ${result.negative.value} negative (baseline ${result.negative.mean.toFixed(1)}, z ${result.negative.z.toFixed(1)}) in the last ${s.windowHours}h.`;
    if (existing) {
      const escalate = existing.severity === "warning" && result.severity === "critical";
      await query(
        "UPDATE cx_crisis_events SET metrics=$2::jsonb, window_end=now(), peak_z=GREATEST(peak_z,$3), severity=CASE WHEN $4 THEN 'critical' ELSE severity END, kind=CASE WHEN kind<>$5 THEN 'both' ELSE kind END, updated_at=now() WHERE id=$1",
        [existing.id, JSON.stringify(result), z, escalate, result.kind],
      );
      if (escalate) {
        await addNote(existing.id, null, "System", `Escalated to critical. ${detail}`, "system");
        if (s.notify) await notify({ ownerId: project.owner_id, projectId: project.id, tool: "cx-crisis", severity: "critical", title: `Crisis escalated: ${sc.name}`, body: detail, link: `/cx/crisis?brand=${project.id}&event=${existing.id}` });
      }
    } else {
      id = randomUUID();
      await query(
        `INSERT INTO cx_crisis_events(id,project_id,topic_id,scope_key,title,kind,severity,owner,metrics,window_start,window_end,peak_z) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now(),$11)`,
        [id, project.id, sc.topicId, sc.key, title, result.kind, result.severity, s.escalationOwner, JSON.stringify(result), result.window.start, z],
      );
      await addNote(id, null, "System", `Spike detected. ${detail}${s.escalationOwner ? ` Escalation owner: ${s.escalationOwner}.` : ""}`, "system");
      opened.push(id);
      if (s.notify)
        await notify({ ownerId: project.owner_id, projectId: project.id, tool: "cx-crisis", severity: result.severity === "critical" ? "critical" : "warning", title, body: detail, link: `/cx/crisis?brand=${project.id}&event=${id}` });
    }
    for (const r of link.slice(0, 1000)) await query("INSERT INTO cx_crisis_mentions(event_id,mention_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, r.id]);
  }
  const summary = { at: now.toISOString(), scopes: results, opened: opened.length };
  await query(
    `INSERT INTO cx_listening_settings(project_id,last_detect_at,last_detect) VALUES($1,now(),$2::jsonb)
     ON CONFLICT(project_id) DO UPDATE SET last_detect_at=now(), last_detect=$2::jsonb`,
    [project.id, JSON.stringify(summary)],
  );
  return summary;
}

export async function listEvents(projectId: string, status?: string) {
  return query<CrisisEvent>(
    `SELECT e.*, t.name topic_name,
       (SELECT count(*)::int FROM cx_crisis_mentions cm WHERE cm.event_id=e.id) mentions,
       (SELECT count(*)::int FROM cx_crisis_mentions cm JOIN cx_mentions m ON m.id=cm.mention_id WHERE cm.event_id=e.id AND m.sentiment='negative') negative
     FROM cx_crisis_events e LEFT JOIN cx_topics t ON t.id=e.topic_id
     WHERE e.project_id=$1 AND ($2::text IS NULL OR e.status=$2) ORDER BY (e.status='resolved'), e.detected_at DESC LIMIT 200`,
    [projectId, status ?? null],
  );
}

export async function getEvent(projectId: string, id: string) {
  const [e] = (await listEvents(projectId)).filter((x) => x.id === id);
  if (!e) throw new AppError("Crisis event not found.", 404);
  const notes = await query<CrisisNote>("SELECT id, author_name, kind, body, created_at FROM cx_crisis_notes WHERE event_id=$1 ORDER BY created_at DESC", [id]);
  const mentions = await query<Mention>(
    `SELECT m.*, t.name topic_name, t.kind topic_kind, k.number ticket_number FROM cx_crisis_mentions cm JOIN cx_mentions m ON m.id=cm.mention_id
     LEFT JOIN cx_topics t ON t.id=m.topic_id LEFT JOIN cx_tickets k ON k.id=m.ticket_id WHERE cm.event_id=$1 ORDER BY m.published_at DESC NULLS LAST LIMIT 300`,
    [id],
  );
  return { event: e, notes, mentions };
}

/** Volume/negative windows around an event (baseline before it through now) for the timeline chart. */
export async function eventTimeline(project: Project, e: CrisisEvent): Promise<Bucket[]> {
  const s = await getSettings(project.id);
  const w = s.windowHours;
  const start = new Date(e.window_start).getTime() - Math.min(s.baselineDays * 24, 14 * 24) * 3600_000;
  const end = e.status === "resolved" && e.resolved_at ? new Date(e.resolved_at).getTime() + w * 3600_000 : Date.now();
  const windows = Math.min(400, Math.max(2, Math.ceil((end - start) / (w * 3600_000))));
  const rows = await query<Row>(
    "SELECT id, topic_id, published_at, sentiment FROM cx_mentions WHERE project_id=$1 AND ($2::text IS NULL OR topic_id=$2) AND published_at > $3 AND published_at <= $4 AND status<>'ignored'",
    [project.id, e.topic_id, new Date(end - windows * w * 3600_000).toISOString(), new Date(end).toISOString()],
  );
  return bucketize(rows, new Date(end), w, windows - 1);
}

export async function addNote(eventId: string, userId: string | null, author: string, body: string, kind: CrisisNote["kind"] = "note") {
  await query("INSERT INTO cx_crisis_notes(id,event_id,author_user_id,author_name,kind,body) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), eventId, userId, author, kind, body.slice(0, 4000)]);
  await query("UPDATE cx_crisis_events SET updated_at=now() WHERE id=$1", [eventId]);
}

export async function updateEvent(projectId: string, id: string, patch: { status?: CrisisEvent["status"]; owner?: string; severity?: CrisisEvent["severity"] }, by: { id: string; name: string }) {
  const [e] = await query<{ status: string; owner: string; severity: string }>("SELECT status, owner, severity FROM cx_crisis_events WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!e) throw new AppError("Crisis event not found.", 404);
  if (patch.status && patch.status !== e.status) {
    await query("UPDATE cx_crisis_events SET status=$2, resolved_at=CASE WHEN $2='resolved' THEN now() ELSE NULL END, updated_at=now() WHERE id=$1", [id, patch.status]);
    await addNote(id, by.id, by.name, `Status changed from ${e.status} to ${patch.status}.`, "status");
  }
  if (patch.owner != null && patch.owner !== e.owner) {
    await query("UPDATE cx_crisis_events SET owner=$2, updated_at=now() WHERE id=$1", [id, patch.owner.slice(0, 120)]);
    await addNote(id, by.id, by.name, patch.owner ? `Escalation owner set to ${patch.owner}.` : "Escalation owner cleared.", "status");
  }
  if (patch.severity && patch.severity !== e.severity) {
    await query("UPDATE cx_crisis_events SET severity=$2, updated_at=now() WHERE id=$1", [id, patch.severity]);
    await addNote(id, by.id, by.name, `Severity changed to ${patch.severity}.`, "status");
  }
}
