/**
 * Email threading (pure, fixture-tested). An inbound email joins an existing ticket when
 * 1) its In-Reply-To / References contain a Message-ID we already stored (inbound or our replies),
 * 2) its subject carries our ticket tag "[#123]", or
 * 3) it has the same normalized subject from the same sender as a recent unsolved ticket.
 */
export type ThreadEmail = { messageId?: string | null; inReplyTo?: string | null; references?: string | string[] | null; subject?: string | null; fromEmail?: string | null };
export type ThreadCandidate = { id: string; number: number; subject: string; contactEmail: string | null; status: string; updatedAt: string };

const PREFIX = /^\s*((re|fw|fwd|aw|sv|vs|antw|wg|rif|r)\s*(\[\d+\])?\s*:\s*)+/i;

/** Subject key for threading: prefixes (Re:/Fwd:/AW:…), ticket tags and whitespace removed, lowercased. */
export function normalizeSubject(subject: string | null | undefined) {
  let s = (subject ?? "").replace(/\[#\d+\]/g, " ");
  for (let i = 0; i < 5; i++) s = s.replace(PREFIX, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Message-IDs from a header value (`<a@b> <c@d>`), normalized without brackets and lowercased. */
export function parseMessageIds(v: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(v) ? v.join(" ") : (v ?? "");
  const ids = raw.match(/<[^<>\s]+>/g)?.map((x) => x.slice(1, -1)) ?? raw.split(/[\s,]+/).filter((x) => x.includes("@"));
  return [...new Set(ids.map((x) => x.trim().toLowerCase()).filter(Boolean))];
}
export const normalizeMessageId = (id: string | null | undefined) => parseMessageIds(id ?? "")[0] ?? null;

export const ticketTag = (n: number) => `[#${n}]`;
export function ticketNumberFromSubject(subject: string | null | undefined) {
  const m = /\[#(\d{1,9})\]/.exec(subject ?? "");
  return m ? Number(m[1]) : null;
}

/** Reply subject: "Re: <original> [#n]" without stacking prefixes or tags. */
export function replySubject(subject: string, n: number) {
  let s = (subject || "Your request").replace(/\s*\[#\d+\]/g, "");
  for (let i = 0; i < 5; i++) s = s.replace(PREFIX, "");
  return `Re: ${s.trim() || "Your request"} ${ticketTag(n)}`;
}

/**
 * Decide the ticket an inbound email belongs to. `knownIds` maps stored Message-IDs → ticket id.
 * Returns the ticket id and the reason, or null when a new ticket should be created.
 */
export function resolveThread(
  email: ThreadEmail,
  knownIds: Record<string, string>,
  candidates: ThreadCandidate[],
  now = new Date(),
  subjectWindowDays = 14,
): { ticketId: string; by: "references" | "ticket-tag" | "subject" } | null {
  const refs = [...parseMessageIds(email.inReplyTo), ...parseMessageIds(email.references)];
  for (const r of refs.reverse()) if (knownIds[r]) return { ticketId: knownIds[r], by: "references" };
  const n = ticketNumberFromSubject(email.subject);
  if (n != null) {
    const t = candidates.find((c) => c.number === n);
    if (t) return { ticketId: t.id, by: "ticket-tag" };
  }
  const key = normalizeSubject(email.subject);
  const from = (email.fromEmail ?? "").toLowerCase();
  if (key && from) {
    const cutoff = now.getTime() - subjectWindowDays * 86_400_000;
    const match = candidates
      .filter((c) => c.status !== "closed" && (c.contactEmail ?? "").toLowerCase() === from && normalizeSubject(c.subject) === key && new Date(c.updatedAt).getTime() >= cutoff)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (match) return { ticketId: match.id, by: "subject" };
  }
  return null;
}

/** Strip quoted history from a plain-text reply ("On … wrote:", "> " lines, Outlook separators). */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{4,200} wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim()) || /^_{10,}$/.test(line.trim()) || /^From: .+/.test(line) && out.length > 0 && out[out.length - 1].trim() === "") break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() || text.trim();
}
