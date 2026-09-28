import { z } from "zod";

/** Survey delivery settings and conditions (client-safe; unit-tested). */
export type SurveyConditions = { channels?: string[]; priorities?: string[]; tags?: string[]; classificationIds?: string[]; fields?: { key: string; value: string }[] };
export type SurveySettings = {
  emailSubject: string;
  emailTemplate: string;
  trigger: "solved" | "closed";
  inline: boolean;
  socialEmail: boolean;
  redirectUrl: string;
  background: string;
  conditions: SurveyConditions;
};

export const DEFAULT_TEMPLATE = "Hi {{name}},\n\n{{question}}\n\n{{rating_links}}\nShare your feedback: {{link}}\n\nThank you,\n{{brand}}";
export const DEFAULT_SETTINGS: SurveySettings = {
  emailSubject: "How did we do? (ticket #{{ticket}})",
  emailTemplate: DEFAULT_TEMPLATE,
  trigger: "solved",
  inline: true,
  socialEmail: false,
  redirectUrl: "",
  background: "",
  conditions: {},
};

const httpUrl = z.union([z.literal(""), z.string().trim().max(500).url("Enter a full https:// URL").refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL")]);
export const settingsInput = z.object({
  emailSubject: z.string().trim().min(1, "Subject is required").max(200),
  emailTemplate: z.string().trim().min(1).max(4000).refine((t) => t.includes("{{link}}") || t.includes("{{rating_links}}"), "The template must include {{link}} or {{rating_links}}"),
  trigger: z.enum(["solved", "closed"]),
  inline: z.boolean(),
  socialEmail: z.boolean(),
  redirectUrl: httpUrl,
  background: httpUrl,
  conditions: z.object({
    channels: z.array(z.string().max(60)).max(30).optional(),
    priorities: z.array(z.enum(["low", "normal", "high", "urgent"])).max(4).optional(),
    tags: z.array(z.string().trim().toLowerCase().max(80)).max(30).optional(),
    classificationIds: z.array(z.string().max(64)).max(50).optional(),
    fields: z.array(z.object({ key: z.string().max(80), value: z.string().max(200) })).max(10).optional(),
  }),
});

/** True when a ticket passes every non-empty condition (any-of within a list, all lists must pass). */
export function matchesConditions(c: SurveyConditions, t: { channel: string; priority: string; tags: string[]; classificationIds: string[]; values: Record<string, unknown> }) {
  if (c.channels?.length && !c.channels.includes(t.channel)) return false;
  if (c.priorities?.length && !c.priorities.includes(t.priority as never)) return false;
  if (c.tags?.length && !c.tags.some((x) => t.tags.includes(x))) return false;
  if (c.classificationIds?.length && !c.classificationIds.some((x) => t.classificationIds.includes(x))) return false;
  for (const f of c.fields ?? []) {
    const v = t.values[f.key];
    const vals = Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
    if (!vals.some((x) => x.toLowerCase() === f.value.toLowerCase())) return false;
  }
  return true;
}

/** Inline rating lines for an email body: one link per score (1–5 CSAT, 0–10 NPS). */
export function inlineRatingLinks(kind: "csat" | "nps", url: string) {
  const sep = url.includes("?") ? "&" : "?";
  const scores = kind === "nps" ? Array.from({ length: 11 }, (_, i) => i) : [5, 4, 3, 2, 1];
  const label = (n: number) => (kind === "nps" ? `${n}` : ["", "1 – Very dissatisfied", "2 – Dissatisfied", "3 – Neutral", "4 – Satisfied", "5 – Very satisfied"][n]);
  return `${kind === "nps" ? "Rate from 0 (not likely) to 10 (very likely):" : "Rate your experience:"}\n${scores.map((n) => `${label(n)}: ${url}${sep}r=${n}`).join("\n")}\n`;
}

export function fillSurveyTemplate(tpl: string, v: { name?: string; ticket?: number; brand?: string; question?: string; link?: string; ratingLinks?: string }) {
  return tpl
    .replace(/\{\{\s*name\s*\}\}/g, v.name || "there")
    .replace(/\{\{\s*ticket\s*\}\}/g, v.ticket != null ? String(v.ticket) : "")
    .replace(/\{\{\s*brand\s*\}\}/g, v.brand ?? "")
    .replace(/\{\{\s*question\s*\}\}/g, v.question ?? "")
    .replace(/\{\{\s*rating_links\s*\}\}/g, v.ratingLinks ?? "")
    .replace(/\{\{\s*link\s*\}\}/g, v.link ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
