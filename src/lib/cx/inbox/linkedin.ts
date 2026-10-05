import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { decryptSecret } from "@/lib/secrets";
import { channelSecret, setChannelResult } from "./channels";
import type { InboundSocial } from "./webhooks";

/**
 * LinkedIn company-page inbox (Community Management API): comments and replies on the organization's posts
 * and @mentions of the organization become tickets; replies are posted as the organization.
 *
 * Thread keys (cx_tickets.external_thread_id): `lic|<postUrn>|<rootCommentUrn>` (comment thread, replies go
 * under the root comment) and `lip|<postUrn>` (a member's post that mentions the page; replies comment on it).
 * There is no public API for LinkedIn page messages (DMs).
 */
const API = "https://api.linkedin.com/rest";
const version = () => process.env.LINKEDIN_API_VERSION || "202509";
type Obj = Record<string, any>;

export type LinkedInThread = { kind: "lic"; postUrn: string; commentUrn: string } | { kind: "lip"; postUrn: string };
export function parseLinkedInThread(key: string | null | undefined): LinkedInThread | null {
  const p = (key ?? "").split("|");
  if (p[0] === "lic" && p[1] && p[2]) return { kind: "lic", postUrn: p[1], commentUrn: p[2] };
  if (p[0] === "lip" && p[1]) return { kind: "lip", postUrn: p[1] };
  return null;
}
/** `urn:li:comment:(urn:li:activity:123,456)` → "456". */
export const commentIdOf = (urn: string) => /,(\d+)\)$/.exec(urn)?.[1] ?? null;

async function li(path: string, token: string, init?: { method?: string; body?: unknown }): Promise<{ json: Obj; id: string | null }> {
  const r = await fetch(`${API}/${path}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "LinkedIn-Version": version(), "X-Restli-Protocol-Version": "2.0.0", ...(init?.body ? { "content-type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  const json = (text ? JSON.parse(text) : {}) as Obj;
  if (!r.ok) throw new Error(json.message ?? `LinkedIn API ${r.status}`);
  return { json, id: r.headers.get("x-restli-id") ?? r.headers.get("x-linkedin-id") };
}

type LiChannel = { id: string; project_id: string; config: Obj; secret_enc: string | null };
/** The channel's own token, else the brand's Publishing LinkedIn connection for the same organization. */
async function tokenFor(ch: LiChannel) {
  const own = channelSecret(ch);
  if (own) return own;
  const [acc] = await query<{ token_enc: string | null }>("SELECT token_enc FROM cx_pub_accounts WHERE project_id=$1 AND kind='linkedin' AND external_id=$2", [ch.project_id, ch.config.accountId]);
  return acc?.token_enc ? decryptSecret(acc.token_enc) : process.env.LINKEDIN_ACCESS_TOKEN || null;
}

const text = (c: Obj) => String(c.message?.text ?? c.commentary ?? "").trim() || "[no text]";
const media = (c: Obj) => ((c.content ?? []) as Obj[]).map((x) => ({ type: "image", url: x.url ?? x.entity?.image ?? undefined })).filter((x) => x.url);
const author = (urn: string) => (urn.startsWith("urn:li:organization:") ? "LinkedIn page" : "LinkedIn member");

/** Map one comment element (pure; fixture-tested). Skips the organization's own comments. */
export function mapComment(orgUrn: string, postUrn: string, c: Obj, postLink: string | null): InboundSocial | null {
  const urn = String(c.commentUrn ?? c.$URN ?? "");
  const actor = String(c.actor ?? c.created?.actor ?? "");
  if (!urn || actor === orgUrn) return null;
  const root = String(c.parentComment ?? urn);
  return {
    platform: "linkedin", accountId: orgUrn, senderId: actor, senderName: author(actor), messageId: urn, text: text(c),
    timestamp: new Date(Number(c.created?.time) || Date.now()).toISOString(), attachments: media(c),
    thread: { key: `lic|${postUrn}|${root}`, label: "Comment on your LinkedIn post", link: postLink },
  };
}
const postLink = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;

/** Poll comments (last 10 posts) and mentions of every LinkedIn inbox channel of a brand; throttled to 5 minutes. */
export async function pollLinkedIn(projectId: string, force = false) {
  const { storeSocial } = await import("./social");
  const chans = await query<LiChannel>("SELECT id,project_id,config,secret_enc FROM cx_channels WHERE project_id=$1 AND kind='linkedin' AND status<>'paused'", [projectId]);
  let stored = 0;
  for (const ch of chans) {
    const last = ch.config.liCheckedAt ? Date.parse(ch.config.liCheckedAt) : 0;
    if (!force && Date.now() - last < 5 * 60_000) continue;
    const orgUrn = String(ch.config.accountId ?? "");
    const token = await tokenFor(ch);
    if (!token || !orgUrn) {
      await setChannelResult(ch.id, "Add a LinkedIn access token (or connect LinkedIn in Publishing) to fetch comments and mentions.");
      continue;
    }
    // First check imports the last 3 days only; later checks overlap by an hour (duplicates are skipped).
    const since = (last || Date.now() - 3 * 86_400_000) - 60 * 60_000;
    const items: InboundSocial[] = [];
    const errors: string[] = [];
    try {
      const posts = (await li(`posts?q=author&author=${encodeURIComponent(orgUrn)}&count=10&sortBy=LAST_MODIFIED`, token)).json.elements ?? [];
      for (const p of posts as Obj[]) {
        const postUrn = String(p.id);
        const comments = ((await li(`socialActions/${encodeURIComponent(postUrn)}/comments?count=50`, token)).json.elements ?? []) as Obj[];
        for (const c of comments) {
          if (Number(c.created?.time) > since) {
            const m = mapComment(orgUrn, postUrn, c, postLink(postUrn));
            if (m) items.push(m);
          }
          // Replies under a comment (one level deep on LinkedIn).
          if (Number(c.commentsSummary?.totalFirstLevelComments) > 0 && Number(c.lastModified?.time ?? c.created?.time) > since) {
            const replies = ((await li(`socialActions/${encodeURIComponent(String(c.commentUrn))}/comments?count=50`, token)).json.elements ?? []) as Obj[];
            for (const r of replies) if (Number(r.created?.time) > since) {
              const m = mapComment(orgUrn, postUrn, { ...r, parentComment: r.parentComment ?? c.commentUrn }, postLink(postUrn));
              if (m) items.push(m);
            }
          }
        }
      }
    } catch (e) {
      errors.push(`comments: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      // Rest.li 2.0: structural characters in List(...) and (start:..,end:..) stay unescaped.
      const notes = ((await li(`organizationalEntityNotifications?q=criteria&organizationalEntity=${encodeURIComponent(orgUrn)}&actions=List(SHARE_MENTION,COMMENT_MENTION)&timeRange=(start:${since},end:${Date.now()})`, token)).json.elements ?? []) as Obj[];
      for (const n of notes) {
        const postUrn = String(n.sourcePost ?? "");
        if (!postUrn) continue;
        if (n.action === "SHARE_MENTION") {
          const p = (await li(`posts/${encodeURIComponent(postUrn)}`, token)).json;
          items.push({
            platform: "linkedin", accountId: orgUrn, senderId: String(p.author ?? ""), senderName: author(String(p.author ?? "")), messageId: postUrn, text: text(p),
            timestamp: new Date(Number(p.publishedAt ?? p.createdAt ?? n.lastModifiedAt) || Date.now()).toISOString(), attachments: [],
            thread: { key: `lip|${postUrn}`, label: "Mentioned your page in a LinkedIn post", link: postLink(postUrn) },
          });
        } else if (n.action === "COMMENT_MENTION" && n.generatedActivity) {
          const id = commentIdOf(String(n.generatedActivity));
          if (!id) continue;
          const c = (await li(`socialActions/${encodeURIComponent(postUrn)}/comments/${id}`, token)).json;
          const m = mapComment(orgUrn, postUrn, { ...c, commentUrn: c.commentUrn ?? n.generatedActivity }, postLink(postUrn));
          if (m) items.push({ ...m, thread: { ...m.thread!, label: "Mentioned your page in a LinkedIn comment" } });
        }
      }
    } catch (e) {
      errors.push(`mentions: ${e instanceof Error ? e.message : String(e)}`);
    }
    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    stored += await storeSocial(items);
    await setChannelResult(ch.id, errors.length ? `LinkedIn ${errors.join("; ")}`.slice(0, 300) : null, { liCheckedAt: new Date().toISOString() });
  }
  return stored;
}

/** Reply as the organization: under the root comment of a comment thread, or as a comment on a mention post. */
export async function sendLinkedInReply(projectId: string, channelId: string | null, threadKey: string | null, body: string) {
  const thread = parseLinkedInThread(threadKey);
  if (!thread) throw new AppError("This LinkedIn ticket has no post to reply to.");
  const [ch] = channelId ? await query<LiChannel>("SELECT id,project_id,config,secret_enc FROM cx_channels WHERE id=$1 AND project_id=$2", [channelId, projectId]) : [];
  const token = ch ? await tokenFor(ch) : null;
  if (!ch || !token) return null;
  const actor = String(ch.config.accountId);
  const target = thread.kind === "lic" ? thread.commentUrn : thread.postUrn;
  const r = await li(`socialActions/${encodeURIComponent(target)}/comments`, token, {
    method: "POST",
    body: { actor, object: thread.postUrn, message: { text: body }, ...(thread.kind === "lic" ? { parentComment: thread.commentUrn } : {}) },
  });
  return String(r.json.commentUrn ?? r.id ?? "") || null;
}
