/**
 * Openable links for tickets, messages and mentions in exports, reports and streams (pure, client-safe).
 *
 * - Listening mention (or a ticket made from one): the mention's own URL.
 * - Facebook comment thread (fbc:<postId>_<commentId>): the Page post with ?comment_id=, which opens that comment.
 * - Facebook visitor post / mention post (fbp:) and review (fbr:): the post or review.
 * - Instagram comment, mention or tag (igc:, igm:, igt:): the post's permalink (Instagram has no per-comment link).
 * - LinkedIn comment / post (lic|, lip|): the feed post.
 * - Email, live chat, web form, WhatsApp, Messenger and Instagram DMs have no public page: the ticket in the app.
 */

/** The post link a public thread's first message ends with ("Comment on your Page post: https://…"), if any. */
export function linkInBody(body: string | null | undefined): string | null {
  const m = /:\s(https?:\/\/\S+)\s*$/.exec((body ?? "").trim());
  return m ? m[1] : null;
}

const commentPart = (id: string) => (id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : id);

/** The platform link of a public conversation, or null when it has none (DMs, email, chat...). */
export function publicLink(t: { threadKey?: string | null; mentionUrl?: string | null; postUrl?: string | null; firstBody?: string | null; commentId?: string | null }): string | null {
  if (t.mentionUrl) return t.mentionUrl;
  const key = t.threadKey ?? "";
  const posted = linkInBody(t.firstBody) ?? t.postUrl ?? null;
  const meta = /^(fbc|fbp|fbr|igc|igm|igt):([^:]+)/.exec(key);
  if (meta) {
    const [, kind, id] = meta;
    if (kind === "fbc") {
      // Facebook comment ids are "<postId>_<commentId>"; the Page post link comes from the first message.
      const base = posted ?? `https://www.facebook.com/${id.split("_")[0]}`;
      const comment = commentPart(t.commentId || id);
      return `${base}${base.includes("?") ? "&" : "?"}comment_id=${encodeURIComponent(comment)}`;
    }
    if (kind === "fbp" || kind === "fbr") return posted ?? `https://www.facebook.com/${id}`;
    return posted; // Instagram: permalink looked up when the comment was stored
  }
  const li = key.split("|");
  if ((li[0] === "lic" || li[0] === "lip") && li[1]) return `https://www.linkedin.com/feed/update/${li[1]}/`;
  return posted;
}

/** The ticket in the app (absolute when APP_ORIGIN is known, so it opens from a spreadsheet). */
export function appTicketLink(ticketId: string, brand: string, origin = typeof process !== "undefined" ? process.env.APP_ORIGIN ?? "" : "") {
  return `${origin.replace(/\/$/, "")}/cx/ticket/${ticketId}?brand=${encodeURIComponent(brand)}`;
}

/** Link column for exports: the platform link, else the ticket in the app. */
export function ticketLink(t: Parameters<typeof publicLink>[0] & { ticketId: string; brand: string }) {
  return publicLink(t) ?? appTicketLink(t.ticketId, t.brand);
}
