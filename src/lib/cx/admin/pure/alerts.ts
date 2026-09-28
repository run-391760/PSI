/** Alerts centre logic (pure, fixture-tested): matching, active hours, formatting, Slack/Telegram payloads. */
import { localMinutes } from "./queue";

export type AlertFilters = { keywords: string[]; exclude: string[]; channels: string[]; sentiments: string[]; priorities: string[]; minItems: number };
export type AlertDelivery = { inapp: boolean; emails: string[]; bcc: string[]; slack: boolean; telegram: boolean };
export type ActiveHours = { start: string; end: string; timezone: string; days: number[] } | null;
export type AlertItem = { id: string; kind: "ticket" | "mention"; title: string; body: string; channel: string; sentiment: string | null; priority: string | null; author: string; url: string; at: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, p: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(p)}`, "iu").test(text);

export function matchAlert(f: AlertFilters, item: AlertItem) {
  const text = `${item.title}\n${item.body}`;
  if (f.keywords.length && !f.keywords.some((k) => has(text, k))) return false;
  if (f.exclude.some((k) => has(text, k))) return false;
  if (f.channels.length && !f.channels.includes(item.channel)) return false;
  if (f.sentiments.length && !f.sentiments.includes(item.sentiment ?? "")) return false;
  if (f.priorities.length && item.kind === "ticket" && !f.priorities.includes(item.priority ?? "")) return false;
  return true;
}

/** Inside the alert's active hours (days: 0=Sunday; empty = every day). */
export function inActiveHours(h: ActiveHours, now = new Date()) {
  if (!h) return true;
  let dow = now.getUTCDay();
  try { dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: h.timezone, weekday: "short" }).format(now)); } catch { /* utc */ }
  if (h.days.length && !h.days.includes(dow)) return false;
  const m = localMinutes(now, h.timezone), [sh, sm] = h.start.split(":").map(Number), [eh, em] = h.end.split(":").map(Number);
  const s = sh * 60 + (sm || 0), e = eh * 60 + (em || 0);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Delayed alerts batch items and fire once the oldest pending item is `delay` minutes old (N1). */
export function readyToFire(oldestItemAt: string | null, delayMinutes: number, now = new Date()) {
  if (!oldestItemAt) return false;
  return now.getTime() - Date.parse(oldestItemAt) >= delayMinutes * 60_000;
}

export function alertText(name: string, items: AlertItem[], max = 10) {
  const lines = items.slice(0, max).map((i) => `• [${i.channel}] ${i.title || i.body.slice(0, 80)}${i.sentiment ? ` (${i.sentiment})` : ""}\n  ${i.url}`);
  return `${name}: ${items.length} new item${items.length === 1 ? "" : "s"}\n\n${lines.join("\n")}${items.length > max ? `\n…and ${items.length - max} more` : ""}`;
}
export function alertCsv(items: AlertItem[]) {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["type,channel,title,body,sentiment,priority,author,url,at", ...items.map((i) => [i.kind, i.channel, i.title, i.body.slice(0, 1000), i.sentiment ?? "", i.priority ?? "", i.author, i.url, i.at].map((v) => q(String(v))).join(","))].join("\n");
}
export function slackPayload(name: string, items: AlertItem[]) {
  return {
    text: `${name}: ${items.length} new item${items.length === 1 ? "" : "s"}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: name.slice(0, 150) } },
      ...items.slice(0, 10).map((i) => ({ type: "section", text: { type: "mrkdwn", text: `*${(i.title || i.body.slice(0, 80)).replace(/[<>&]/g, "")}*\n${i.channel}${i.sentiment ? ` · ${i.sentiment}` : ""} · <${i.url}|Open>` } })),
    ],
  };
}
export function telegramPayload(chatId: string, name: string, items: AlertItem[]) {
  return { chat_id: chatId, text: alertText(name, items).slice(0, 4000), disable_web_page_preview: true };
}

/** Telegram delivers at most one alert per 10 minutes per alert (N3). */
export const TELEGRAM_MIN_INTERVAL_MIN = 10;
export const telegramAllowed = (lastFiredAt: string | null, now = new Date()) => !lastFiredAt || now.getTime() - Date.parse(lastFiredAt) >= TELEGRAM_MIN_INTERVAL_MIN * 60_000;
export const validSlackWebhook = (u: string) => /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(u.trim());
export const validTelegramToken = (t: string) => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(t.trim());
