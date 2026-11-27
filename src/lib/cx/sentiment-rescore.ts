import { query } from "@/lib/db";
import { aiSentimentEnabled, aiSentiments, sentimentBudgetLeft } from "./sentiment-ai";

/**
 * Re-score existing tickets and listening mentions with Gemini (Sarvam fallback): everything still labelled by the
 * built-in word list (sentiment_source IS NULL), newest first. Labels a person set (ticket sentiment_manual,
 * mention sentiment_source='manual') and star-rated reviews are never touched. Runs hourly as
 * "cx.listening.rescore" and keeps RESERVE of the day's AI budget for new items, so a large backlog is cleared over
 * a few runs. Abusive tickets get the "abusive" tag.
 */
export const RESCORE_PER_RUN = 300;
const RESERVE = 500;

const FOOTER = /\n\n[^\n]{3,80}:\s+https?:\/\/\S+\s*$/;

export async function rescoreSentiment(projectId: string) {
  if (!aiSentimentEnabled()) return { tickets: 0, mentions: 0, left: null as number | null, reason: "No Gemini or Sarvam key, or AI sentiment is turned off." };
  // Star ratings stay the label for reviews.
  await query("UPDATE cx_mentions SET sentiment_source='rating' WHERE project_id=$1 AND sentiment_source IS NULL AND (engagement->>'rating') IS NOT NULL", [projectId]);
  const room = Math.min(RESCORE_PER_RUN, sentimentBudgetLeft() - RESERVE);
  if (room <= 0) return { tickets: 0, mentions: 0, left: null, reason: "Today's AI budget is reserved for new tickets and mentions." };

  const tickets = await query<{ id: string; subject: string; body: string | null; tags: string[] }>(
    `SELECT t.id, t.subject, t.tags,
            (SELECT m.body FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in' ORDER BY m.created_at, m.id LIMIT 1) AS body
       FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id
      WHERE t.project_id=$1 AND t.sentiment_source IS NULL AND NOT COALESCE(tm.sentiment_manual, false)
      ORDER BY t.created_at DESC LIMIT $2`,
    [projectId, Math.ceil(room / 2)],
  );
  const mentions = await query<{ id: string; title: string; body: string; translation: string | null }>(
    `SELECT id, title, left(body, 1500) body, translation FROM cx_mentions
      WHERE project_id=$1 AND sentiment_source IS NULL AND status<>'ignored'
      ORDER BY published_at DESC NULLS LAST LIMIT $2`,
    [projectId, room - tickets.length],
  );

  let doneT = 0, doneM = 0;
  const tScores = await aiSentiments(tickets.map((t) => `${t.subject}\n${(t.body ?? "").replace(FOOTER, "")}`.trim()));
  for (const [i, t] of tickets.entries()) {
    const s = tScores[i];
    if (!s) continue;
    const tags = s.abusive && !(t.tags ?? []).includes("abusive") ? [...(t.tags ?? []), "abusive"] : t.tags ?? [];
    await query("UPDATE cx_tickets SET sentiment=$2, sentiment_source='ai', tags=$3::jsonb WHERE id=$1", [t.id, s.sentiment, JSON.stringify(tags)]);
    doneT++;
  }
  const mScores = await aiSentiments(mentions.map((m) => m.translation || `${m.title} ${m.body}`.trim()));
  for (const [i, m] of mentions.entries()) {
    const s = mScores[i];
    if (!s) continue;
    await query("UPDATE cx_mentions SET sentiment=$2, sentiment_score=$3, sentiment_source='ai' WHERE id=$1", [m.id, s.sentiment, s.score]);
    doneM++;
  }
  const [left] = await query<{ n: number }>(
    `SELECT (SELECT count(*)::int FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id WHERE t.project_id=$1 AND t.sentiment_source IS NULL AND NOT COALESCE(tm.sentiment_manual,false))
          + (SELECT count(*)::int FROM cx_mentions WHERE project_id=$1 AND sentiment_source IS NULL AND status<>'ignored') AS n`,
    [projectId],
  );
  return { tickets: doneT, mentions: doneM, left: left?.n ?? null, reason: null };
}
