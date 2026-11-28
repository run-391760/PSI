import { randomUUID } from "node:crypto";
import { z } from "zod";
import { complete } from "@/lib/cx/ai";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { Project } from "@/lib/projects";
import { countBy, topTerms, type MentionRow } from "./analytics";
import { dailyCounts, recoveryCurve } from "./crisis-math";
import { addNote, getEvent, type CrisisEvent } from "./crisis";
import { createTicketFromMention, listTopics } from "./data";
import { topPhrases } from "./insights";

/** Crisis v2 (server): extra settings, auto-ticketing, playbooks + checklists, recovery, debrief, AI statement. */

export type ExtraSettings = { autoTicket: boolean; autoTicketAll: boolean; ratingDrop: number; trendingAlerts: boolean };

export async function getExtraSettings(projectId: string): Promise<ExtraSettings> {
  const [r] = await query<{ auto_ticket: boolean; auto_ticket_all: boolean; rating_drop: number; trending_alerts: boolean }>(
    "SELECT auto_ticket, auto_ticket_all, rating_drop, trending_alerts FROM cx_listening_settings WHERE project_id=$1",
    [projectId],
  );
  return { autoTicket: r?.auto_ticket ?? false, autoTicketAll: r?.auto_ticket_all ?? false, ratingDrop: Number(r?.rating_drop ?? 0.5), trendingAlerts: r?.trending_alerts ?? true };
}

export const extraInput = z.object({ autoTicket: z.boolean(), autoTicketAll: z.boolean(), ratingDrop: z.coerce.number().min(0.1).max(4), trendingAlerts: z.boolean() });
export async function saveExtraSettings(projectId: string, input: z.input<typeof extraInput>) {
  const s = extraInput.parse(input);
  await query(
    `INSERT INTO cx_listening_settings(project_id,auto_ticket,auto_ticket_all,rating_drop,trending_alerts) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(project_id) DO UPDATE SET auto_ticket=$2, auto_ticket_all=$3, rating_drop=$4, trending_alerts=$5`,
    [projectId, s.autoTicket, s.autoTicketAll, s.ratingDrop, s.trendingAlerts],
  );
}

// ------------------------------------------------------------------ auto-ticketing (N6)

/** Create inbox tickets for an event's linked mentions (negative only unless `all`); returns the count created. */
export async function ticketEventMentions(projectId: string, eventId: string, opts: { all?: boolean; limit?: number; by?: string } = {}) {
  const rows = await query<{ id: string }>(
    `SELECT m.id FROM cx_crisis_mentions cm JOIN cx_mentions m ON m.id=cm.mention_id
     WHERE cm.event_id=$1 AND m.project_id=$2 AND m.ticket_id IS NULL AND m.status<>'ignored' AND ($3::boolean OR m.sentiment='negative')
     ORDER BY m.published_at DESC NULLS LAST LIMIT $4`,
    [eventId, projectId, !!opts.all, opts.limit ?? 25],
  );
  let created = 0;
  const numbers: number[] = [];
  for (const r of rows) {
    const t = await createTicketFromMention(projectId, r.id);
    if (!t.existing) {
      created++;
      numbers.push(t.number);
    }
  }
  if (created) await addNote(eventId, null, opts.by ?? "System", `Created ${created} inbox ticket${created > 1 ? "s" : ""} from crisis mentions: ${numbers.map((n) => `#${n}`).join(", ")}.`, "system");
  return created;
}

// ------------------------------------------------------------------ playbooks (N11)

export type PlaybookStep = { id: string; text: string };
export type Playbook = { id: string; name: string; description: string; auto_attach: "none" | "any" | "critical"; steps: PlaybookStep[]; created_at: string };
export type ChecklistItem = PlaybookStep & { done: boolean; by: string | null; at: string | null };
export type Checklist = { playbook_id: string; name: string; items: ChecklistItem[] };

/** Starter playbooks a brand gets once (edit or delete them freely; they are not re-created). */
const STARTER_PLAYBOOKS: z.input<typeof playbookInput>[] = [
  { name: "Negative spike response", description: "First-hour response to a negative sentiment spike.", autoAttach: "critical",
    steps: ["Confirm the facts with the owning team", "Post a holding statement on affected channels", "Brief support agents with the reply template", "Reply to the top 10 most-followed authors", "Share an update within 4 hours", "Write the debrief once resolved"] },
  { name: "Comment storm on our posts", description: "Many comments on the university's own Facebook, Instagram or LinkedIn posts.", autoAttach: "any",
    steps: ["Open Social Listening and the linked tickets to see which post is affected", "Hide or delete abusive and spam comments (keep genuine criticism visible)", "Pin or post one factual reply on the post", "Answer direct questions from the inbox using the agreed template", "Escalate to the ORM lead if it reaches news or more than one platform", "Review sentiment after 24 hours and resolve or keep monitoring"] },
  { name: "Admissions or fees complaint wave", description: "Repeated complaints about admissions, fees, results or placements.", autoAttach: "none",
    steps: ["Collect the common questions from linked tickets and mentions", "Get the confirmed answer from the admissions or accounts office", "Add it to the knowledge base for agents and the AI assistant", "Reply to each open ticket with the confirmed answer", "Publish a clarification post if the issue is widespread", "Track resolution and close the event"] },
];

/** Give a brand the starter playbooks once, so Playbooks and auto-attach work from day one. */
export async function ensureStarterPlaybooks(projectId: string) {
  const [s] = await query<{ playbooks_seeded: boolean }>("SELECT playbooks_seeded FROM cx_listening_settings WHERE project_id=$1", [projectId]);
  if (s?.playbooks_seeded) return;
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int n FROM cx_crisis_playbooks WHERE project_id=$1", [projectId]);
  if (!n) for (const p of STARTER_PLAYBOOKS) await savePlaybook(projectId, p);
  await query("INSERT INTO cx_listening_settings(project_id,playbooks_seeded) VALUES($1,true) ON CONFLICT(project_id) DO UPDATE SET playbooks_seeded=true", [projectId]);
}

export async function listPlaybooks(projectId: string) {
  return query<Playbook>("SELECT id, name, description, auto_attach, steps, created_at FROM cx_crisis_playbooks WHERE project_id=$1 ORDER BY created_at", [projectId]);
}

export const playbookInput = z.object({
  name: z.string().trim().min(1, "Name the playbook.").max(80),
  description: z.string().trim().max(500).default(""),
  autoAttach: z.enum(["none", "any", "critical"]).default("none"),
  steps: z.array(z.string().trim().max(300)).max(40).transform((a) => a.filter(Boolean)).refine((a) => a.length > 0, "Add at least one step."),
});

export async function savePlaybook(projectId: string, input: z.input<typeof playbookInput>, id?: string) {
  const p = playbookInput.parse(input);
  const steps = JSON.stringify(p.steps.map((text, i) => ({ id: `s${i + 1}`, text })));
  if (id) {
    const r = await query("UPDATE cx_crisis_playbooks SET name=$3, description=$4, auto_attach=$5, steps=$6::jsonb WHERE id=$1 AND project_id=$2 RETURNING id", [id, projectId, p.name, p.description, p.autoAttach, steps]);
    if (!r.length) throw new AppError("Playbook not found.", 404);
    return id;
  }
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int n FROM cx_crisis_playbooks WHERE project_id=$1", [projectId]);
  if (n >= 30) throw new AppError("A brand can have up to 30 playbooks.");
  const newId = randomUUID();
  await query("INSERT INTO cx_crisis_playbooks(id,project_id,name,description,auto_attach,steps) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [newId, projectId, p.name, p.description, p.autoAttach, steps]);
  return newId;
}

export async function deletePlaybook(projectId: string, id: string) {
  await query("DELETE FROM cx_crisis_playbooks WHERE id=$1 AND project_id=$2", [id, projectId]);
}

export async function attachPlaybook(projectId: string, eventId: string, playbookId: string, by: string) {
  const [pb] = await query<Playbook>("SELECT * FROM cx_crisis_playbooks WHERE id=$1 AND project_id=$2", [playbookId, projectId]);
  const [ev] = await query("SELECT id FROM cx_crisis_events WHERE id=$1 AND project_id=$2", [eventId, projectId]);
  if (!pb || !ev) throw new AppError("Playbook or event not found.", 404);
  const items: ChecklistItem[] = pb.steps.map((s) => ({ ...s, done: false, by: null, at: null }));
  const r = await query("INSERT INTO cx_crisis_checklists(event_id,playbook_id,items) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING event_id", [eventId, playbookId, JSON.stringify(items)]);
  if (r.length) await addNote(eventId, null, by, `Playbook attached: ${pb.name}.`, "status");
}

export async function autoAttachPlaybooks(projectId: string, eventId: string, severity: CrisisEvent["severity"]) {
  const pbs = (await listPlaybooks(projectId)).filter((p) => p.auto_attach === "any" || (p.auto_attach === "critical" && severity === "critical"));
  for (const p of pbs) await attachPlaybook(projectId, eventId, p.id, "System");
}

export async function eventChecklists(eventId: string) {
  return query<Checklist>("SELECT c.playbook_id, p.name, c.items FROM cx_crisis_checklists c JOIN cx_crisis_playbooks p ON p.id=c.playbook_id WHERE c.event_id=$1 ORDER BY c.created_at", [eventId]);
}

export async function toggleChecklistItem(projectId: string, eventId: string, playbookId: string, itemId: string, done: boolean, by: string) {
  const [c] = await query<{ items: ChecklistItem[] }>(
    "SELECT c.items FROM cx_crisis_checklists c JOIN cx_crisis_events e ON e.id=c.event_id WHERE c.event_id=$1 AND c.playbook_id=$2 AND e.project_id=$3",
    [eventId, playbookId, projectId],
  );
  if (!c) throw new AppError("Checklist not found.", 404);
  const item = c.items.find((i) => i.id === itemId);
  if (!item) throw new AppError("Step not found.", 404);
  item.done = done;
  item.by = done ? by : null;
  item.at = done ? new Date().toISOString() : null;
  await query("UPDATE cx_crisis_checklists SET items=$3::jsonb WHERE event_id=$1 AND playbook_id=$2", [eventId, playbookId, JSON.stringify(c.items)]);
  if (done) await addNote(eventId, null, by, `Completed: ${item.text}`, "status");
}

// ------------------------------------------------------------------ recovery (N9)

/** Daily volume/negative for the event scope from `baselineDays` before the spike to 90 days after (or now). */
export async function eventRecovery(projectId: string, e: CrisisEvent, baselineDays = 14) {
  const start = new Date(e.window_start);
  const from = new Date(start.getTime() - baselineDays * 86400000);
  const to = new Date(Math.min(Date.now(), start.getTime() + 90 * 86400000));
  const { eventScopeRows } = await import("./crisis");
  const rows = await eventScopeRows(projectId, e, from.toISOString(), to.toISOString());
  const coverage = await query<{ t: string | Date | null }>("SELECT min(published_at) t FROM cx_mentions WHERE project_id=$1 AND ($2::text IS NULL OR topic_id=$2)", [projectId, e.topic_id]);
  const since = coverage[0]?.t ? new Date(coverage[0].t).toISOString().slice(0, 10) : null;
  const daily = dailyCounts(rows, from.toISOString(), to.toISOString()).filter((d) => !since || d.date >= since);
  return recoveryCurve(daily, new Date(e.window_start).toISOString(), new Date(), baselineDays);
}

// ------------------------------------------------------------------ debrief (N10)

export async function debrief(project: Project, eventId: string) {
  const { event, notes, mentions } = await getEvent(project.id, eventId);
  const topics = await listTopics(project.id);
  const tRefs = topics.map((t) => ({ id: t.id, name: t.name, kind: t.kind, keywords: t.keywords }));
  const rows: MentionRow[] = mentions.map((m) => ({ ...m, published_at: m.published_at ? new Date(m.published_at).toISOString() : null }));
  const tickets = await query<{ number: number; status: string; first_response_at: string | null; resolved_at: string | null; created_at: string }>(
    "SELECT k.number, k.status, k.first_response_at, k.resolved_at, k.created_at FROM cx_crisis_mentions cm JOIN cx_mentions m ON m.id=cm.mention_id JOIN cx_tickets k ON k.id=m.ticket_id WHERE cm.event_id=$1",
    [eventId],
  );
  const firstHuman = [...notes].reverse().find((n) => n.kind !== "system");
  const recovery = await eventRecovery(project.id, event);
  const authors = new Map<string, { author: string; source: string; n: number; followers: number | null }>();
  for (const m of mentions) {
    const k = `${m.source}:${m.author_handle ?? m.author}`;
    const a = authors.get(k) ?? { author: m.author, source: m.source, n: 0, followers: m.author_followers };
    a.n++;
    authors.set(k, a);
  }
  return {
    event,
    notes: [...notes].reverse(),
    mentions: rows,
    sources: countBy(rows, (r) => r.source),
    intents: countBy(rows, (r) => r.intent),
    terms: topTerms(rows, tRefs, 15),
    phrases: topPhrases(rows, tRefs, 2, 10),
    authors: [...authors.values()].sort((a, b) => b.n - a.n || (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 8),
    tickets,
    responseMinutes: firstHuman ? Math.max(0, (new Date(firstHuman.created_at).getTime() - new Date(event.detected_at).getTime()) / 60000) : null,
    durationHours: (new Date(event.resolved_at ?? Date.now()).getTime() - new Date(event.window_start).getTime()) / 3600000,
    recovery,
  };
}

// ------------------------------------------------------------------ AI response templates (N8)

/** Holding statement + reply template grounded in the event's mentions. Null when no AI key is configured. */
export async function draftStatement(project: Project, eventId: string) {
  const { event, mentions } = await getEvent(project.id, eventId);
  const sample = mentions
    .slice(0, 25)
    .map((m) => `- [${m.source}, ${m.sentiment ?? "neutral"}] ${(m.title ? `${m.title}: ` : "") + m.body}`.slice(0, 300))
    .join("\n");
  return complete(
    "You are a communications lead drafting crisis responses. Be factual, empathetic and brief. Never invent facts, numbers or commitments; use [placeholders] for anything unknown.",
    `Brand: ${project.name}\nEvent: ${event.title} (${event.severity}, ${event.mentions} mentions, ${event.negative} negative)\nSample mentions:\n${sample}\n\nWrite:\n1. A holding statement (≤ 80 words) for social channels.\n2. A reply template (≤ 50 words) for individual complaints.\n3. Three bullet points on what to verify before the next update.`,
    700,
  );
}
