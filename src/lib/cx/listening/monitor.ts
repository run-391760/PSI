import { query } from "@/lib/db";
import { notify } from "@/lib/jobs/queue";
import type { Project } from "@/lib/projects";
import { parseRule } from "./sources";
import { listTopics } from "./data";
import { ratingDrop, trendingIssues, trendLabel, type Review, type TrendDoc } from "./insights";

/** Review-rating and trending-issue monitors (run after every detection; alerts are deduplicated). */

export async function reviewRows(projectId: string, days = 120): Promise<(Review & { id: string; title: string; body: string; author: string; topic_id: string | null; url: string | null; country: string | null })[]> {
  const rows = await query<{ id: string; published_at: string | Date | null; rating: number | null; title: string; body: string; author: string; topic_id: string | null; url: string | null; country: string | null }>(
    `SELECT id, published_at, (engagement->>'rating')::float8 rating, title, body, author, topic_id, url, country FROM cx_mentions
     WHERE project_id=$1 AND source='appstore' AND published_at > now() - ($2 * interval '1 day') AND status<>'ignored' ORDER BY published_at DESC`,
    [projectId, days],
  );
  return rows.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null }));
}

/** Rating-drop alert: at most one per 24 h per brand. */
export async function checkRatingDrop(project: Project, threshold: number) {
  const rows = await reviewRows(project.id, 40);
  const r = ratingDrop(rows, new Date(), { threshold });
  if (!r.triggered) return r;
  const [s] = await query<{ rating_alert_at: string | null }>("SELECT rating_alert_at FROM cx_listening_settings WHERE project_id=$1", [project.id]);
  if (s?.rating_alert_at && Date.now() - new Date(s.rating_alert_at).getTime() < 86400000) return r;
  await query("UPDATE cx_listening_settings SET rating_alert_at=now() WHERE project_id=$1", [project.id]);
  await notify({
    ownerId: project.owner_id,
    projectId: project.id,
    tool: "cx-reviews",
    severity: (r.drop ?? 0) >= threshold * 2 ? "critical" : "warning",
    title: `App rating dropped ${r.drop!.toFixed(2)} stars`,
    body: `Last 7 days average ${r.recentAvg!.toFixed(2)} (${r.recentCount} reviews) vs ${r.baselineAvg!.toFixed(2)} over the previous 30 days (${r.baselineCount} reviews).`,
    link: `/cx/listening/reviews?brand=${project.id}`,
  });
  return r;
}

/** Mentions + tickets as documents for the trending-issue detector. */
export async function trendDocs(projectId: string, days = 15): Promise<TrendDoc[]> {
  const [m, t] = await Promise.all([
    query<{ id: string; title: string; body: string; published_at: string | Date | null }>("SELECT id, title, body, published_at FROM cx_mentions WHERE project_id=$1 AND published_at > now() - ($2 * interval '1 day') AND status<>'ignored'", [projectId, days]),
    query<{ id: string; subject: string; body: string | null; created_at: string | Date }>(
      `SELECT k.id, k.subject, (SELECT body FROM cx_messages WHERE ticket_id=k.id AND direction='in' ORDER BY created_at LIMIT 1) body, k.created_at
       FROM cx_tickets k WHERE k.project_id=$1 AND k.created_at > now() - ($2 * interval '1 day') AND NOT (k.tags ? 'listening')`,
      [projectId, days],
    ),
  ]);
  return [
    ...m.map((r) => ({ id: r.id, kind: "mention" as const, text: `${r.title} ${r.body}`.slice(0, 3000), at: r.published_at ? new Date(r.published_at).toISOString() : null })),
    ...t.map((r) => ({ id: r.id, kind: "ticket" as const, text: `${r.subject} ${r.body ?? ""}`.slice(0, 3000), at: new Date(r.created_at).toISOString() })),
  ];
}

export async function trendingFor(projectId: string, windowHours = 24) {
  const topics = await listTopics(projectId);
  const exclude = new Set(topics.flatMap((t) => t.keywords.flatMap((k) => parseRule(k).flat().flatMap((p) => [p, ...p.split(" ")]))));
  const docs = await trendDocs(projectId, 15);
  return { issues: trendingIssues(docs, new Date(), { windowHours, baselineDays: 14, exclude }), docs: docs.length };
}

/** Alert on trending issues not alerted in the last 3 days. */
export async function alertTrending(project: Project) {
  const { issues } = await trendingFor(project.id);
  if (!issues.length) return 0;
  const [s] = await query<{ trending_sent: Record<string, string> }>("SELECT trending_sent FROM cx_listening_settings WHERE project_id=$1", [project.id]);
  const sent = s?.trending_sent ?? {};
  const now = Date.now();
  const fresh = issues.filter((i) => !sent[i.term] || now - new Date(sent[i.term]).getTime() > 3 * 86400000).slice(0, 3);
  if (!fresh.length) return 0;
  for (const i of fresh) sent[i.term] = new Date().toISOString();
  const pruned = Object.fromEntries(Object.entries(sent).filter(([, v]) => now - new Date(v).getTime() < 7 * 86400000));
  await query("UPDATE cx_listening_settings SET trending_sent=$2::jsonb WHERE project_id=$1", [project.id, JSON.stringify(pruned)]);
  await notify({
    ownerId: project.owner_id,
    projectId: project.id,
    tool: "cx-trending",
    severity: "info",
    title: fresh.length === 1 ? `Trending issue: ${fresh[0].term}` : `${fresh.length} trending issues`,
    body: fresh.map(trendLabel).join("\n"),
    link: `/cx/listening/dashboards?brand=${project.id}&tab=trending`,
  });
  return fresh.length;
}
