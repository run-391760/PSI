import { query } from "@/lib/db";
import { cached } from "@/lib/providers/source";
import { enqueue, notify } from "@/lib/jobs/queue";
import { channelAvailable } from "@/lib/cx/providers";
import { outcomeStatus, pubChannel, type ChannelResult, type PubChannel } from "./core";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/domain";
import { canDelete, deletePublished, fetchInsights, fetchYoutube, publishers, uploadYoutube, type ChannelStats, type Media } from "./adapters";
import { assetFile, connections, credsFor, getPost, getSettings, mediaKind, postText, youtubeUploadToken, type Access, type Asset, type PostRow } from "./data";
import { typeSupport } from "./options";

/** Public base URL for media Meta must download (null on local/private hosts it cannot reach). */
function publicBase(origin: string | null) {
  const base = (process.env.APP_URL || origin || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(base) || /\/\/(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(base)) return null;
  return base;
}

async function mediaFor(p: PostRow, ids: string[] = p.media): Promise<Media[]> {
  if (!ids.length) return [];
  const rows = await query<Asset>("SELECT * FROM cx_pub_assets WHERE project_id=$1 AND id = ANY($2::text[])", [p.project_id, ids]);
  const base = publicBase(p.origin);
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((a): a is Asset => !!a)
    .map((a) => ({ kind: mediaKind(a.mime), mime: a.mime, filename: a.filename, publicUrl: base ? `${base}/api/cx/publishing/media/${a.public_token}` : null, read: () => assetFile(a) }));
}

/** System entry in a post's activity log. */
async function logActivity(postId: string, kind: string, body: string) {
  await query("INSERT INTO cx_pub_comments(id,post_id,user_id,author_name,kind,body) VALUES($1,$2,NULL,'Publisher',$3,$4)", [randomUUID(), postId, kind, body.slice(0, 4000)]);
}

/** Failed-post alerts: in-app for the author, owner and designated approvers; email to them via the brand's email channel when enabled. */
async function notifyFailure(p: PostRow, label: string, body: string) {
  const [owner] = await query<{ owner_id: string }>("SELECT owner_id FROM projects WHERE id=$1", [p.project_id]);
  const to = [...new Set([p.author_id, owner?.owner_id, ...p.approver_ids].filter((x): x is string => !!x))];
  const link = `/cx/publishing/${p.id}?brand=${p.project_id}`;
  for (const u of to) await notify({ ownerId: u, projectId: p.project_id, tool: "cx-publishing", severity: "critical", title: `Post failed: ${label}`, body, link });
  if (!(await getSettings(p.project_id)).failureEmail) return "off";
  const [ch] = await query<{ config: any; secret_enc: string | null }>("SELECT config, secret_enc FROM cx_channels WHERE project_id=$1 AND kind='email' AND status<>'paused' ORDER BY created_at LIMIT 1", [p.project_id]).catch(() => []);
  if (!ch) return "no-channel";
  const users = await query<{ email: string }>("SELECT email FROM users WHERE id = ANY($1::text[])", [to]);
  const base = (process.env.APP_URL || p.origin || "").replace(/\/$/, "");
  try {
    const { sendEmail } = await import("@/lib/cx/inbox/email");
    for (const u of users) await sendEmail(ch, { to: u.email, subject: `Post failed: ${label}`, text: `${body}\n\nEdit and reschedule: ${base}${link}` });
    return "sent";
  } catch (e) {
    console.error("cx-publishing failure email", e);
    return "error";
  }
}

/** Publish one due post to each of its channels (skips channels already published). */
export async function publishPost(p: PostRow) {
  const media = await mediaFor(p);
  const results: Record<string, ChannelResult> = { ...p.results };
  const at = () => new Date().toISOString();
  for (const kind of p.channels) {
    if (["published", "manual"].includes(results[kind]?.status ?? "")) continue;
    const send = publishers[kind];
    const info = pubChannel(kind);
    if (kind === "youtube" && p.post_type === "reel") {
      const token = await youtubeUploadToken(p.project_id);
      if (!token) results[kind] = { status: "not_connected", error: "Link a YouTube OAuth upload token (youtube.upload scope) in Channels & roles, or set YOUTUBE_UPLOAD_ACCESS_TOKEN.", at: at() };
      else
        try {
          const out = await uploadYoutube(token, { text: postText(p, kind), firstComment: "", link: p.link_url, media, postType: p.post_type, options: p.options.youtube ?? {}, common: p.options.common ?? {} });
          results[kind] = { status: "published", externalId: out.externalId, url: out.url ?? undefined, at: at() };
        } catch (e) {
          results[kind] = { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : String(e), at: at() };
        }
      continue;
    }
    if (!send) {
      results[kind] = { status: "not_connected", error: info?.note ?? "No publishing API for this channel.", at: at() };
      continue;
    }
    const support = typeSupport(p.post_type, kind);
    if (support !== "api") {
      results[kind] = { status: "not_connected", error: support === "manual" ? "This post type is published manually on this network: publish it, then mark it published." : "This network does not support this post type.", at: at() };
      continue;
    }
    const creds = await credsFor(p.project_id, kind);
    if (!creds) {
      const conn = (await connections(p.project_id)).find((c) => c.kind === kind);
      results[kind] = { status: "not_connected", error: `Channel not connected: ${conn?.reason ?? "credentials missing"}`, at: at() };
      continue;
    }
    try {
      const opts = p.options[kind] ?? {};
      const cover = typeof opts.cover === "string" ? ((await mediaFor(p, [opts.cover]))[0] ?? null) : null;
      const out = await send(creds, { text: postText(p, kind), firstComment: info?.firstComment ? p.first_comment : "", link: p.link_url, media, postType: p.post_type, options: opts, common: p.options.common ?? {}, cover });
      results[kind] = { status: "published", externalId: out.externalId, url: out.url ?? undefined, error: out.warnings.join(" ") || undefined, at: at() };
    } catch (e) {
      results[kind] = { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : String(e), at: at() };
    }
  }
  const status = outcomeStatus(Object.fromEntries(p.channels.map((k) => [k, results[k]])));
  await query(
    `UPDATE cx_pub_posts SET results=$2::jsonb, status=$3, published_at=CASE WHEN $3='published' THEN now() ELSE published_at END, dispatching_until=NULL, updated_at=now() WHERE id=$1`,
    [p.id, JSON.stringify(results), status],
  );
  const label = p.title || p.body.slice(0, 60) || "Post";
  const summary = p.channels.map((k) => `${pubChannel(k)?.name ?? k}: ${results[k]?.status.replace("_", " ")}${results[k]?.error ? ` — ${results[k].error}` : ""}`).join("\n");
  await logActivity(p.id, status === "published" ? "publish" : "failed", summary);
  if (status === "published") {
    const [owner] = await query<{ owner_id: string }>("SELECT owner_id FROM projects WHERE id=$1", [p.project_id]);
    const notifyUser = p.author_id ?? owner?.owner_id;
    if (notifyUser) await notify({ ownerId: notifyUser, projectId: p.project_id, tool: "cx-publishing", severity: "success", title: `Published: ${label}`, body: summary, link: `/cx/publishing/${p.id}?brand=${p.project_id}` });
  } else {
    const mail = await notifyFailure(p, label, summary);
    if (mail === "sent") await logActivity(p.id, "notice", "Failure email sent to the author, owner and approvers.");
  }
  return { id: p.id, status };
}

/** Delete a published post from one network (where the API allows it) and record it in the activity log. */
export async function deletePublishedPost(access: Access, user: { id: string; name: string; email: string }, postId: string, kind: string) {
  const p = await getPost(access.brand.id, postId);
  const r = p.results[kind];
  if (!r || r.status !== "published" || !r.externalId) throw new AppError("That channel has no post published through the API.");
  if (!canDelete(kind)) throw new AppError(`${pubChannel(kind)?.name ?? kind} does not allow deleting posts through its API; delete it in the app.`);
  const creds = kind === "youtube" ? await youtubeUploadToken(p.project_id).then((t) => (t ? { externalId: "", token: t } : null)) : await credsFor(p.project_id, kind as PubChannel);
  if (!creds) throw new AppError("The channel is not connected any more.");
  await deletePublished(kind as PubChannel, creds, r.externalId);
  const results = { ...p.results, [kind]: { ...r, status: "deleted", at: new Date().toISOString() } as ChannelResult };
  await query("UPDATE cx_pub_posts SET results=$2::jsonb, updated_at=now() WHERE id=$1", [p.id, JSON.stringify(results)]);
  await query("INSERT INTO cx_pub_comments(id,post_id,user_id,author_name,kind,body) VALUES($1,$2,$3,$4,'deleted',$5)", [randomUUID(), p.id, user.id, user.name || user.email, `Deleted from ${pubChannel(kind)?.name ?? kind}`]);
}

/** Claim and publish all due posts (every brand), then chain the next minute's run while posts remain scheduled. */
export async function dispatchDue(ownerId: string | null) {
  const claimed = await query<{ id: string; project_id: string }>(
    `UPDATE cx_pub_posts SET dispatching_until=now()+interval '10 minutes'
     WHERE id IN (SELECT id FROM cx_pub_posts WHERE status='scheduled' AND scheduled_at<=now() AND (dispatching_until IS NULL OR dispatching_until<now())
                  ORDER BY scheduled_at LIMIT 25 FOR UPDATE SKIP LOCKED)
     RETURNING id, project_id`,
  );
  const done: { id: string; status: string }[] = [];
  for (const c of claimed) done.push(await publishPost(await getPost(c.project_id, c.id)));
  const [next] = await query<{ project_id: string; owner_id: string }>(
    "SELECT p.project_id, pr.owner_id FROM cx_pub_posts p JOIN projects pr ON pr.id=p.project_id WHERE p.status='scheduled' ORDER BY p.scheduled_at LIMIT 1",
  );
  if (next) {
    const runAfter = new Date(Math.ceil((Date.now() + 1000) / 60_000) * 60_000);
    await enqueue({ kind: "cx.publishing.dispatch", ownerId: ownerId ?? next.owner_id, projectId: next.project_id, payload: {}, runAfter, dedupeKey: `cx.publishing.dispatch:${runAfter.toISOString().slice(0, 16)}` });
  }
  return { published: done.filter((d) => d.status === "published").length, failed: done.filter((d) => d.status !== "published").length, checked: claimed.length };
}

// ================================================================= social analytics

export type InsightResult = { kind: PubChannel; stats: ChannelStats | null; error: string | null; fetchedAt: string | null; connected: boolean; reason: string | null };

async function snapshot(projectId: string, s: ChannelStats) {
  await query(
    `INSERT INTO cx_pub_stats(project_id,kind,day,followers,views,posts) VALUES($1,$2,current_date,$3,$4,$5)
     ON CONFLICT(project_id,kind,day) DO UPDATE SET followers=excluded.followers, views=excluded.views, posts=excluded.posts`,
    [projectId, s.kind, s.followers, s.views, s.posts],
  );
}

/** Real insights per channel for a brand (6 h cache; errors are never cached). */
export async function channelInsights(projectId: string): Promise<InsightResult[]> {
  const conns = await connections(projectId);
  const out: InsightResult[] = [];
  for (const c of conns) {
    const connected = c.kind === "youtube" ? channelAvailable("youtube") && !!c.account : c.connected;
    if (!connected) {
      out.push({ kind: c.kind, stats: null, error: null, fetchedAt: null, connected: false, reason: c.reason });
      continue;
    }
    try {
      const creds = await credsFor(projectId, c.kind);
      if (!creds) throw new Error("Credentials unavailable.");
      const r = await cached(`cx-pub:insights:${c.kind}:${creds.externalId}`, "user", 6, async () => {
        const s = c.kind === "youtube" ? await fetchYoutube(creds.token, creds.externalId) : await fetchInsights(c.kind, creds);
        if (!s) throw new Error(c.kind === "youtube" ? "YouTube returned no channel for that ID." : "No data returned.");
        return s;
      });
      await snapshot(projectId, r.data);
      out.push({ kind: c.kind, stats: r.data, error: null, fetchedAt: r.fetchedAt, connected: true, reason: null });
    } catch (e) {
      out.push({ kind: c.kind, stats: null, error: e instanceof Error ? e.message : String(e), fetchedAt: null, connected: true, reason: null });
    }
  }
  return out;
}

export async function statHistory(projectId: string) {
  return query<{ kind: string; day: string; followers: number | null; views: number | null }>(
    "SELECT kind, to_char(day,'YYYY-MM-DD') AS day, followers::float8 followers, views::float8 views FROM cx_pub_stats WHERE project_id=$1 AND day > current_date - 180 ORDER BY day",
    [projectId],
  );
}

/** Posts published through SynapseSEO, per channel (own records). */
export async function publishedSummary(projectId: string, days: number) {
  return query<{ kind: string; published: number; failed: number }>(
    `SELECT k.kind, count(*) FILTER (WHERE p.results->k.kind->>'status' IN ('published','manual'))::int published,
       count(*) FILTER (WHERE p.results->k.kind->>'status' IN ('failed','not_connected'))::int failed
     FROM cx_pub_posts p, jsonb_array_elements_text(p.channels) AS k(kind)
     WHERE p.project_id=$1 AND p.updated_at > now() - ($2 * interval '1 day') AND p.status IN ('published','failed')
     GROUP BY k.kind ORDER BY 2 DESC`,
    [projectId, days],
  );
}
