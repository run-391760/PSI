import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError, database } from "@/lib/domain";
import { rng, serp } from "@/lib/seo/engine";
import { ideaPool, type PoolRow } from "./ideas";
import { metricsSource } from "./metrics";
import { liveSerpItems } from "./serp";
import { cleanTitle } from "./serp-map";
import { matchesSeed, normalizeKw, rowHasWord, titleCase, wordGroups } from "./text";
import type { AutocompleteInfo } from "./types";

export type IdeaKind = "headline" | "question" | "related";
export type TopicIdea = {
  text: string;
  kind: IdeaKind;
  /** serp = title of a page ranking in the top 10; template = generated angle; autocomplete = real Google suggestion. */
  origin: "serp" | "template" | "autocomplete" | "database";
  volume: number | null;
  backlinks: number | null;
  domain: string | null;
};
export type Subtopic = {
  id: string;
  name: string;
  keyword: string;
  keywords: number;
  /** null when no metrics provider is connected. */
  volume: number | null;
  difficulty: number | null;
  /** Volume per unit of difficulty, as a percentile among the subtopics (0..100); null without metrics. */
  efficiency: number | null;
  efficiencyLabel: "High" | "Medium" | "Low" | null;
  headlines: TopicIdea[];
  questions: TopicIdea[];
  related: TopicIdea[];
};
export type TopicResearch = {
  topic: string;
  db: string;
  topicName: string;
  volume: number | null;
  difficulty: number | null;
  subtopics: Subtopic[];
  topHeadlines: TopicIdea[];
  topQuestions: TopicIdea[];
  relatedSearches: TopicIdea[];
  /** "autocomplete": no metrics provider; subtopics, questions and related searches are real Autocomplete suggestions. */
  source: "demo" | "dataforseo" | "autocomplete";
  /** Headlines come from ranking page titles (live or demo SERPs); false = only generated angles. */
  serpHeadlines: boolean;
  fetchedAt: string;
  autocomplete: AutocompleteInfo;
};

const YEAR = new Date().getUTCFullYear();
const HEADLINE_TEMPLATES = [
  "The Ultimate Guide to {K} ({Y})",
  "{N} Best {K} (Tested & Reviewed for {Y})",
  "How to Choose {K}: {N} Expert Tips",
  "{K}: Everything You Need to Know",
  "Are {K} Worth It? An Honest Look",
  "{N} Mistakes to Avoid With {K}",
  "The Beginner's Guide to {K}",
  "{K} on a Budget: {N} Smart Picks",
  "Why {K} Matter More Than You Think",
  "{K} Explained: Pros, Cons and Alternatives",
  "What Nobody Tells You About {K}",
  "{K} Checklist: {N} Things to Check First",
];
const QUESTION_TEMPLATES = ["What are the best {k}?", "How do you choose {k}?", "Are {k} worth the money?", "Where can I find {k}?", "How much do {k} cost?", "What should I look for in {k}?", "Is it worth investing in {k}?", "How long do {k} last?"];

/** Modifier words that make poor content subtopics on their own. */
const WEAK_SUBTOPICS = new Set(["under", "over", "buy", "online", "top", "good", "new", "easy", "simple", "set", "with", "without", "pdf", "logo", "image", "youtube", "reddit", "2025", "2026", "2027", "today", "near", "best", "cheap", "affordable", "local", "free", "small", "big", "uk", "usa", "india"]);

/** Ranking page titles for a keyword (live or demo SERP). */
type TitleSource = (keyword: string, depth: number) => Promise<{ title: string; url: string; domain: string; position: number }[]>;

async function subtopicIdeas(topic: string, db: string, groupId: string, members: PoolRow[], allAc: PoolRow[], titles: TitleSource | null, demo: boolean, serpKeywords: number) {
  const top = [...members].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.order - b.order);
  const main = top[0];
  const r = rng(`topic-ideas:${topic}:${db}:${groupId}`);
  const headlines: TopicIdea[] = [];
  const seen = new Set<string>();
  if (titles)
    for (const m of top.filter((x) => !x.question).slice(0, serpKeywords)) {
      const results = await titles(m.keyword, 6).catch(() => []);
      for (const s of results) {
        const text = cleanTitle(s.title);
        if (!text || seen.has(text.toLowerCase()) || text.toLowerCase() === m.keyword) continue;
        seen.add(text.toLowerCase());
        // Backlinks per ranking page exist only in the demo engine; live headlines show none.
        const backlinks = demo ? Math.round(rng(`topic-bl:${s.url}`).logNormal(40 / Math.sqrt(s.position), 1.1)) : null;
        headlines.push({ text, kind: "headline", origin: "serp", volume: m.volume, backlinks, domain: s.domain });
        if (headlines.length >= 6) break;
      }
    }
  const k = titleCase(main.keyword);
  // Generated angles (labelled "Idea"). Outside local demo mode they carry no invented numbers.
  const templates = demo ? HEADLINE_TEMPLATES : HEADLINE_TEMPLATES.filter((t) => !t.includes("{N}"));
  // Without ranking titles (no DataForSEO) no generated angles are shown: only real suggestions.
  if (demo || titles) for (const t of r.sample(templates, demo ? 4 : 3)) {
    const text = t.replace("{K}", k).replace("{Y}", String(YEAR)).replace("{N}", String(r.int(5, 15)));
    if (!seen.has(text.toLowerCase())) headlines.push({ text, kind: "headline", origin: "template", volume: null, backlinks: null, domain: null });
  }
  const questions: TopicIdea[] = [];
  const qSeen = new Set<string>();
  const addQ = (text: string, origin: TopicIdea["origin"], volume: number | null) => {
    const t = text.trim().replace(/\?*$/, "?");
    const key = t.toLowerCase();
    if (qSeen.has(key)) return;
    qSeen.add(key);
    questions.push({ text: t.charAt(0).toUpperCase() + t.slice(1), kind: "question", origin, volume, backlinks: null, domain: null });
  };
  for (const m of allAc.filter((x) => x.question && rowHasWord(x.keyword, groupId)).slice(0, 4)) addQ(m.keyword, "autocomplete", m.volume);
  for (const m of top.filter((x) => x.question).slice(0, 6)) addQ(m.keyword, m.ac ? "autocomplete" : "database", m.volume);
  if (demo) for (const t of r.sample(QUESTION_TEMPLATES, 3)) addQ(t.replace("{k}", main.keyword), "template", null);
  const related: TopicIdea[] = top
    .filter((x) => !x.question && x.keyword !== main.keyword)
    .slice(0, 8)
    .map((x) => ({ text: x.keyword, kind: "related" as const, origin: x.ac ? ("autocomplete" as const) : ("database" as const), volume: x.volume, backlinks: null, domain: null }));
  return { headlines: headlines.slice(0, 9), questions: questions.slice(0, 8), related };
}

const MEMO = new Map<string, { expires: number; value: Promise<TopicResearch> }>();

/** Topic Research: subtopics (word groups of the topic's keyword ideas) with headlines, questions and related searches. Memoized 10 minutes. */
export async function getTopicResearch(ownerId: string, topicInput: string, dbInput: string): Promise<TopicResearch> {
  const topic = normalizeKw(topicInput);
  const db = database(dbInput).code;
  const key = `${metricsSource()}|${ownerId}|${db}|${topic}`;
  const hit = MEMO.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  const entry = { expires: Date.now() + 10 * 60_000, value: buildTopicResearch(ownerId, topic, db) };
  MEMO.set(key, entry);
  if (MEMO.size > 40) MEMO.delete(MEMO.keys().next().value as string);
  entry.value.then((t) => t.autocomplete.status === "failed" && (entry.expires = Date.now() + 60_000)).catch(() => MEMO.delete(key));
  return entry.value;
}

async function buildTopicResearch(ownerId: string, topic: string, db: string): Promise<TopicResearch> {
  const pool = await ideaPool(ownerId, topic, db);
  const hasMetrics = pool.source !== "autocomplete";
  const demo = pool.source === "demo";
  const titles: TitleSource | null =
    pool.source === "dataforseo" ? (k) => liveSerpItems(ownerId, k, db) : demo ? async (k, depth) => serp(k, db, { depth }) : null;
  const rows = pool.rows.filter((r) => matchesSeed(r.keyword, topic, "broad"));
  const acRows = pool.rows.filter((r) => r.ac).sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.order - b.order);
  // Autocomplete-only pools are small (~300 suggestions), so two keywords are enough to form a subtopic.
  const groups = wordGroups(rows, topic, 80).filter((g) => g.count >= (hasMetrics ? 3 : 2) && !WEAK_SUBTOPICS.has(g.id));
  const picked = [...groups].sort((a, b) => (hasMetrics ? b.volume - a.volume : 0) || b.count - a.count).slice(0, 24);
  const raw = picked.map((g) => {
    const members = rows.filter((r) => rowHasWord(r.keyword, g.id));
    const kdRows = members.filter((m) => m.kd != null);
    const weight = kdRows.reduce((s, m) => s + (m.volume ?? 0) + 1, 0);
    const difficulty = kdRows.length ? Math.round(kdRows.reduce((s, m) => s + (m.kd ?? 0) * ((m.volume ?? 0) + 1), 0) / weight) : null;
    const main = [...members].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.order - b.order)[0];
    const volume = members.some((m) => m.volume != null) ? g.volume : null;
    return { g, members, difficulty, main, volume, ratio: volume == null ? null : volume / ((difficulty ?? 50) + 10) };
  });
  const ratios = raw.map((x) => x.ratio).filter((x): x is number => x != null).sort((a, b) => a - b);
  // Live SERP headlines cost one request per keyword: only each subtopic's main keyword (cached 24 h).
  const serpKeywords = pool.source === "dataforseo" ? 1 : 3;
  const subtopics: Subtopic[] = await Promise.all(
    raw.map(async ({ g, members, difficulty, main, volume, ratio }) => {
      const efficiency = ratio == null ? null : ratios.length > 1 ? Math.round((ratios.indexOf(ratio) / (ratios.length - 1)) * 100) : 100;
      return {
        id: g.id,
        name: titleCase(g.label),
        keyword: main.keyword,
        keywords: members.length,
        volume,
        difficulty,
        efficiency,
        efficiencyLabel: efficiency == null ? null : efficiency >= 67 ? "High" : efficiency >= 34 ? "Medium" : "Low",
        ...(await subtopicIdeas(topic, db, g.id, members, acRows, titles, demo, serpKeywords)),
      };
    }),
  );
  const all = <K extends "headlines" | "questions">(k: K) => subtopics.flatMap((s) => s[k]);
  const dedupe = (ideas: TopicIdea[]) => [...new Map(ideas.map((i) => [i.text.toLowerCase(), i])).values()];
  const kd = rows.filter((r) => r.kd != null);
  const questions = dedupe(all("questions"));
  return {
    topic,
    db,
    topicName: pool.topicName,
    volume: rows.some((r) => r.volume != null) ? rows.reduce((s, r) => s + (r.volume ?? 0), 0) : null,
    difficulty: kd.length ? Math.round(kd.reduce((s, r) => s + (r.kd ?? 0), 0) / kd.length) : null,
    subtopics,
    topHeadlines: dedupe(all("headlines").filter((h) => h.origin === "serp"))
      .sort((a, b) => (b.backlinks ?? 0) - (a.backlinks ?? 0))
      .slice(0, 10),
    topQuestions: hasMetrics
      ? questions.filter((q) => q.volume != null).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 10)
      : // Without volumes: every real Autocomplete question for the topic, in Google's order.
        dedupe(acRows.filter((r) => r.question).map((r) => ({ text: r.keyword.charAt(0).toUpperCase() + r.keyword.slice(1).replace(/\?*$/, "?"), kind: "question" as const, origin: "autocomplete" as const, volume: null, backlinks: null, domain: null }))).slice(0, 15),
    relatedSearches: (acRows.length ? acRows.filter((r) => !r.question) : rows)
      .filter((r) => r.keyword !== topic)
      .slice(0, 15)
      .map((r) => ({ text: r.keyword, kind: "related", origin: r.ac ? "autocomplete" : "database", volume: r.volume, backlinks: null, domain: null })),
    source: pool.source,
    serpHeadlines: titles != null,
    fetchedAt: pool.fetchedAt,
    autocomplete: pool.autocomplete,
  };
}

// ------------------------------------------------------------------ favorites

export type Favorite = { id: string; topic: string; db: string; kind: string; text: string; subtopic: string; createdAt: string };

export async function listFavorites(ownerId: string): Promise<Favorite[]> {
  const rows = await query<{ id: string; topic: string; db: string; kind: string; text: string; subtopic: string; created_at: Date | string }>(
    "SELECT id,topic,db,kind,text,subtopic,created_at FROM kw_topic_favorites WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1000",
    [ownerId],
  );
  return rows.map((r) => ({ id: r.id, topic: r.topic, db: r.db, kind: r.kind, text: r.text, subtopic: r.subtopic, createdAt: new Date(r.created_at).toISOString() }));
}

const KINDS = ["headline", "question", "subtopic", "related"];

/** Adds or removes a favorite idea; returns the new state. */
export async function toggleFavorite(ownerId: string, input: { topic: string; db: string; kind: string; text: string; subtopic?: string }) {
  const topic = normalizeKw(input.topic);
  const text = String(input.text ?? "").trim().slice(0, 300);
  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!topic || !text || !kind) throw new AppError("Invalid idea.");
  const db = database(input.db).code;
  const removed = await query("DELETE FROM kw_topic_favorites WHERE owner_id=$1 AND topic=$2 AND db=$3 AND kind=$4 AND text=$5 RETURNING id", [ownerId, topic, db, kind, text]);
  if (removed.length) return false;
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM kw_topic_favorites WHERE owner_id=$1", [ownerId]);
  if (n >= 1000) throw new AppError("You can save up to 1,000 favorite ideas. Remove some first.");
  await query("INSERT INTO kw_topic_favorites(id,owner_id,topic,db,kind,text,subtopic) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [randomUUID(), ownerId, topic, db, kind, text, String(input.subtopic ?? "").slice(0, 120)]);
  return true;
}

export async function removeFavorite(ownerId: string, id: string) {
  await query("DELETE FROM kw_topic_favorites WHERE owner_id=$1 AND id=$2", [ownerId, id]);
}
