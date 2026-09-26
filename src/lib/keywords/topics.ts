import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError, database } from "@/lib/domain";
import { liveEnabled } from "@/lib/providers/source";
import { rng, serp } from "@/lib/seo/engine";
import { ideaPool, type PoolRow } from "./ideas";
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
  volume: number;
  difficulty: number | null;
  /** Volume per unit of difficulty, as a percentile among the subtopics (0..100). */
  efficiency: number;
  efficiencyLabel: "High" | "Medium" | "Low";
  headlines: TopicIdea[];
  questions: TopicIdea[];
  related: TopicIdea[];
};
export type TopicResearch = {
  topic: string;
  db: string;
  topicName: string;
  volume: number;
  difficulty: number | null;
  subtopics: Subtopic[];
  topHeadlines: TopicIdea[];
  topQuestions: TopicIdea[];
  relatedSearches: TopicIdea[];
  source: "demo" | "dataforseo";
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

/** Removes the " | Brand" / " - Brand" tail of a SERP title (the domain is shown separately). */
const cleanTitle = (t: string) => t.replace(/\s+[|–-]\s+[^|–-]+$/, "").trim();

function subtopicIdeas(topic: string, db: string, groupId: string, members: PoolRow[], allAc: PoolRow[]) {
  const top = [...members].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const main = top[0];
  const r = rng(`topic-ideas:${topic}:${db}:${groupId}`);
  const headlines: TopicIdea[] = [];
  const seen = new Set<string>();
  for (const m of top.filter((x) => !x.question).slice(0, 3))
    for (const s of serp(m.keyword, db, { depth: 6 })) {
      const text = cleanTitle(s.title);
      if (seen.has(text.toLowerCase()) || text.toLowerCase() === m.keyword) continue;
      seen.add(text.toLowerCase());
      const g = rng(`topic-bl:${s.url}`);
      headlines.push({ text, kind: "headline", origin: "serp", volume: m.volume, backlinks: Math.round(g.logNormal(40 / Math.sqrt(s.position), 1.1)), domain: s.domain });
      if (headlines.length >= 6) break;
    }
  const k = titleCase(main.keyword);
  for (const t of r.sample(HEADLINE_TEMPLATES, 4)) {
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
  for (const t of r.sample(QUESTION_TEMPLATES, 3)) addQ(t.replace("{k}", main.keyword), "template", null);
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
  const key = `${liveEnabled() ? ownerId : "demo"}|${db}|${topic}`;
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
  const rows = pool.rows.filter((r) => matchesSeed(r.keyword, topic, "broad"));
  const acRows = pool.rows.filter((r) => r.ac).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const groups = wordGroups(rows, topic, 80).filter((g) => g.count >= 3 && !WEAK_SUBTOPICS.has(g.id));
  const picked = [...groups].sort((a, b) => b.volume - a.volume).slice(0, 24);
  const raw = picked.map((g) => {
    const members = rows.filter((r) => rowHasWord(r.keyword, g.id));
    const kdRows = members.filter((m) => m.kd != null);
    const weight = kdRows.reduce((s, m) => s + (m.volume ?? 0) + 1, 0);
    const difficulty = kdRows.length ? Math.round(kdRows.reduce((s, m) => s + (m.kd ?? 0) * ((m.volume ?? 0) + 1), 0) / weight) : null;
    const main = [...members].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
    return { g, members, difficulty, main, ratio: g.volume / ((difficulty ?? 50) + 10) };
  });
  const ratios = raw.map((x) => x.ratio).sort((a, b) => a - b);
  const subtopics: Subtopic[] = raw.map(({ g, members, difficulty, main, ratio }) => {
    const efficiency = ratios.length > 1 ? Math.round((ratios.indexOf(ratio) / (ratios.length - 1)) * 100) : 100;
    return {
      id: g.id,
      name: titleCase(g.label),
      keyword: main.keyword,
      keywords: members.length,
      volume: g.volume,
      difficulty,
      efficiency,
      efficiencyLabel: efficiency >= 67 ? "High" : efficiency >= 34 ? "Medium" : "Low",
      ...subtopicIdeas(topic, db, g.id, members, acRows),
    };
  });
  const all = <K extends "headlines" | "questions">(k: K) => subtopics.flatMap((s) => s[k]);
  const dedupe = (ideas: TopicIdea[]) => [...new Map(ideas.map((i) => [i.text.toLowerCase(), i])).values()];
  const kd = rows.filter((r) => r.kd != null);
  return {
    topic,
    db,
    topicName: pool.topicName,
    volume: rows.reduce((s, r) => s + (r.volume ?? 0), 0),
    difficulty: kd.length ? Math.round(kd.reduce((s, r) => s + (r.kd ?? 0), 0) / kd.length) : null,
    subtopics,
    topHeadlines: dedupe(all("headlines").filter((h) => h.origin === "serp")).sort((a, b) => (b.backlinks ?? 0) - (a.backlinks ?? 0)).slice(0, 10),
    topQuestions: dedupe(all("questions").filter((q) => q.volume != null)).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 10),
    relatedSearches: (acRows.length ? acRows.filter((r) => !r.question) : rows)
      .filter((r) => r.keyword !== topic)
      .slice(0, 15)
      .map((r) => ({ text: r.keyword, kind: "related", origin: r.ac ? "autocomplete" : "database", volume: r.volume, backlinks: null, domain: null })),
    source: pool.source,
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
