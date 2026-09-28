import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { MediaItem } from "./connectors";

/** UGC board: stored mentions that carry images/videos, with a rights/consent tracker per mention. */

export const CONSENT_STATUSES = ["requested", "granted", "denied", "withdrawn"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export type UgcItem = {
  id: string;
  source: string;
  url: string | null;
  author: string;
  author_handle: string | null;
  author_followers: number | null;
  title: string;
  body: string;
  published_at: string | null;
  sentiment: string | null;
  engagement: Record<string, number>;
  topic_name: string | null;
  media: MediaItem[];
  consent_id: string | null;
  consent: ConsentStatus | null;
  request_text: string | null;
  rights_note: string | null;
  requested_at: string | null;
  responded_at: string | null;
  history: { at: string; by: string; status: string; note?: string }[] | null;
};

export async function listUgc(projectId: string, filter: { consent?: string; type?: string; sentiment?: string } = {}, limit = 120) {
  const params: unknown[] = [projectId];
  const conds = ["m.project_id=$1", "m.status<>'ignored'"];
  if (filter.consent === "none") conds.push("c.id IS NULL");
  else if (filter.consent && (CONSENT_STATUSES as readonly string[]).includes(filter.consent)) {
    params.push(filter.consent);
    conds.push(`c.status=$${params.length}`);
  }
  if (filter.type === "image" || filter.type === "video") {
    params.push(JSON.stringify([{ type: filter.type }]));
    conds.push(`x.media @> $${params.length}::jsonb`);
  }
  if (filter.sentiment && ["positive", "neutral", "negative"].includes(filter.sentiment)) {
    params.push(filter.sentiment);
    conds.push(`m.sentiment=$${params.length}`);
  }
  return query<UgcItem>(
    `SELECT m.id, m.source, m.url, m.author, m.author_handle, m.author_followers, m.title, m.body, m.published_at, m.sentiment, m.engagement, t.name topic_name, x.media,
       c.id consent_id, c.status consent, c.request_text, c.rights_note, c.requested_at, c.responded_at, c.history
     FROM cx_listening_media x JOIN cx_mentions m ON m.id=x.mention_id LEFT JOIN cx_topics t ON t.id=m.topic_id LEFT JOIN cx_ugc_consent c ON c.mention_id=m.id AND c.project_id=m.project_id
     WHERE ${conds.join(" AND ")} ORDER BY m.published_at DESC NULLS LAST LIMIT ${limit}`,
    params,
  );
}

export async function ugcCounts(projectId: string) {
  const [r] = await query<{ total: number; images: number; videos: number; requested: number; granted: number; denied: number; withdrawn: number }>(
    `SELECT count(*)::int total,
       count(*) FILTER (WHERE x.media @> '[{"type":"image"}]')::int images,
       count(*) FILTER (WHERE x.media @> '[{"type":"video"}]')::int videos,
       count(*) FILTER (WHERE c.status='requested')::int requested, count(*) FILTER (WHERE c.status='granted')::int granted,
       count(*) FILTER (WHERE c.status='denied')::int denied, count(*) FILTER (WHERE c.status='withdrawn')::int withdrawn
     FROM cx_listening_media x JOIN cx_mentions m ON m.id=x.mention_id LEFT JOIN cx_ugc_consent c ON c.mention_id=m.id
     WHERE x.project_id=$1 AND m.status<>'ignored'`,
    [projectId],
  );
  return r;
}

/** The default consent-request message (the user sends it on the network; we track the answer). */
export function consentMessage(brand: string, handle: string | null) {
  return `Hi ${handle ?? "there"}, we love this post! May ${brand} share it on our channels and website, with credit to you? Reply #YesTo${brand.replace(/[^A-Za-z0-9]/g, "")} to agree. Thank you!`;
}

export const consentInput = z.object({
  mentionId: z.string().max(64),
  status: z.enum(CONSENT_STATUSES),
  requestText: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function setConsent(projectId: string, input: z.input<typeof consentInput>, by: string) {
  const c = consentInput.parse(input);
  const [m] = await query("SELECT id FROM cx_mentions WHERE id=$1 AND project_id=$2", [c.mentionId, projectId]);
  if (!m) throw new AppError("Mention not found.", 404);
  const entry = JSON.stringify([{ at: new Date().toISOString(), by, status: c.status, ...(c.note ? { note: c.note } : {}) }]);
  await query(
    `INSERT INTO cx_ugc_consent(id,project_id,mention_id,status,request_text,rights_note,history,responded_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,CASE WHEN $4='requested' THEN NULL ELSE now() END)
     ON CONFLICT(project_id,mention_id) DO UPDATE SET status=$4, request_text=COALESCE(NULLIF($5,''), cx_ugc_consent.request_text), rights_note=COALESCE(NULLIF($6,''), cx_ugc_consent.rights_note),
       history=cx_ugc_consent.history || $7::jsonb, responded_at=CASE WHEN $4='requested' THEN NULL ELSE now() END, requested_at=CASE WHEN $4='requested' THEN now() ELSE cx_ugc_consent.requested_at END, updated_at=now()`,
    [randomUUID(), projectId, c.mentionId, c.status, c.requestText ?? "", c.note ?? "", entry],
  );
}

export async function clearConsent(projectId: string, mentionId: string) {
  await query("DELETE FROM cx_ugc_consent WHERE project_id=$1 AND mention_id=$2", [projectId, mentionId]);
}
