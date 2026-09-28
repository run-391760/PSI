/** Download centre catalogue (client-safe): export columns, periods, CSV encoding. */
export type ExportSource = "tickets" | "messages";
export type ExportColumn = { key: string; label: string };
export type Period = "today" | "yesterday" | "7" | "30" | "31" | "month";

export const EXPORT_COLUMNS: Record<ExportSource, ExportColumn[]> = {
  tickets: [
    { key: "number", label: "Ticket #" },
    { key: "subject", label: "Subject" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "channel", label: "Channel" },
    { key: "agent", label: "Agent" },
    { key: "team", label: "Team" },
    { key: "contact", label: "Contact" },
    { key: "contact_email", label: "Contact email" },
    { key: "tags", label: "Tags" },
    { key: "sentiment", label: "Sentiment" },
    { key: "intent", label: "Intent" },
    { key: "language", label: "Language" },
    { key: "created_at", label: "Created (UTC)" },
    { key: "first_response_at", label: "First response (UTC)" },
    { key: "resolved_at", label: "Resolved (UTC)" },
    { key: "updated_at", label: "Last updated (UTC)" },
    { key: "frt", label: "First response TAT (HH:MM:SS)" },
    { key: "resolution_tat", label: "Resolution TAT (HH:MM:SS)" },
    { key: "fr_due", label: "First response due (UTC)" },
    { key: "res_due", label: "Resolution due (UTC)" },
    { key: "fr_breached", label: "FRT breached" },
    { key: "res_breached", label: "Resolution breached" },
    { key: "csat", label: "CSAT" },
    { key: "messages", label: "Messages" },
  ],
  messages: [
    { key: "number", label: "Ticket #" },
    { key: "subject", label: "Subject" },
    { key: "channel", label: "Channel" },
    { key: "direction", label: "From" },
    { key: "author", label: "Author" },
    { key: "body", label: "Message" },
    { key: "created_at", label: "Sent (UTC)" },
    { key: "delivery", label: "Delivery" },
    { key: "reply_tat", label: "Reply TAT (HH:MM:SS)" },
  ],
};

export const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today so far" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7", label: "Last 7 complete days" },
  { value: "30", label: "Last 30 days" },
  { value: "31", label: "Last 31 days" },
  { value: "month", label: "Current month" },
];

/** [from, to) of a period in UTC days; "Last N days" ends at the start of today (complete days). */
export function periodRange(p: Period, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = 86400000;
  const d = (x: Date) => x.toISOString().slice(0, 10);
  if (p === "today") return { from: today, to: now, label: `${d(today)} to date` };
  if (p === "yesterday") return { from: new Date(today.getTime() - day), to: today, label: d(new Date(today.getTime() - day)) };
  if (p === "month") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from, to: now, label: `${d(from).slice(0, 7)} to date` };
  }
  const n = Number(p);
  const from = new Date(today.getTime() - n * day);
  return { from, to: today, label: `${d(from)} to ${d(new Date(today.getTime() - day))}` };
}

/** RFC 4180 CSV with a UTF-8 BOM-free body; cells with comma/quote/newline are quoted. */
export function toCsv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Neutralize spreadsheet formulas.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
