import robotsParser from "robots-parser";
import { auditHtml, fetchPublic } from "@/lib/crawler";
import { AI_BOTS, type BotAccess, type ReadinessResult } from "./meta";

/**
 * Real AI crawler readiness check: fetches robots.txt, /llms.txt, /llms-full.txt and the homepage of
 * the project domain (SSRF-safe fetchPublic) and reports what each AI crawler may access.
 */

type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };

/** Minimal robots.txt grouping (RFC 9309): consecutive user-agent lines share the following rules. */
export function robotsGroups(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

export function botAccess(txt: string | null, origin: string): BotAccess[] {
  if (txt == null) return AI_BOTS.map((b) => ({ agent: b.agent, status: "allowed", rule: "none", disallowed: [] }));
  const groups = robotsGroups(txt);
  const parser = robotsParser(`${origin}/robots.txt`, txt);
  return AI_BOTS.map((b) => {
    const token = b.agent.toLowerCase();
    const explicit = groups.filter((g) => g.agents.includes(token));
    const wildcard = groups.filter((g) => g.agents.includes("*"));
    const applied = explicit.length ? explicit : wildcard;
    const disallowed = applied.flatMap((g) => g.rules.filter((r) => !r.allow).map((r) => r.path));
    const rootAllowed = parser.isAllowed(`${origin}/`, b.agent) !== false;
    const status: BotAccess["status"] = !rootAllowed ? "blocked" : disallowed.length ? "partial" : "allowed";
    return { agent: b.agent, status, rule: explicit.length ? "explicit" : wildcard.length ? "wildcard" : "none", disallowed: [...new Set(disallowed)].slice(0, 12) };
  });
}

const isHtml = (body: string) => /^\s*(<!doctype|<html|<head|<body)/i.test(body);

export async function checkReadiness(domain: string): Promise<ReadinessResult> {
  const origin = `https://${domain}`;
  const [robots, llms, llmsFull, home] = await Promise.allSettled([
    fetchPublic(`${origin}/robots.txt`),
    fetchPublic(`${origin}/llms.txt`),
    fetchPublic(`${origin}/llms-full.txt`),
    fetchPublic(`${origin}/`),
  ]);
  const errMsg = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : null);

  // robots.txt
  let robotsTxt: string | null = null;
  let robotsStatus: number | null = null;
  let finalOrigin = origin;
  if (robots.status === "fulfilled") {
    robotsStatus = robots.value.status;
    try {
      finalOrigin = new URL(robots.value.url).origin;
    } catch {
      /* keep origin */
    }
    if (robots.value.status === 200 && !isHtml(robots.value.body)) robotsTxt = robots.value.body;
  }
  const robotsFound = robotsTxt != null;
  const bots = robots.status === "rejected" || (robotsStatus != null && robotsStatus >= 500) ? AI_BOTS.map((b) => ({ agent: b.agent, status: "unknown" as const, rule: "none" as const, disallowed: [] })) : botAccess(robotsTxt, finalOrigin);
  const sitemaps = robotsTxt ? [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 5) : [];

  // llms.txt
  const llmsOk = llms.status === "fulfilled" && llms.value.status === 200 && !isHtml(llms.value.body) && llms.value.body.trim().length > 0;
  const llmsBody = llmsOk && llms.status === "fulfilled" ? llms.value.body : "";
  const title = llmsBody.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;

  // Homepage
  let homepage: ReadinessResult["homepage"] = { status: null, words: 0, noai: false, structured: [], title: "", error: errMsg(home) };
  if (home.status === "fulfilled") {
    const a = auditHtml(home.value.body, home.value.url, home.value.headers);
    homepage = { status: home.value.status, words: a.words, noai: /\bnoai\b|\bnoimageai\b/i.test(a.robots), structured: a.structured.slice(0, 8), title: a.title, error: null };
  }

  return {
    domain,
    checkedUrl: finalOrigin,
    robots: { status: robotsStatus, found: robotsFound, error: errMsg(robots), sitemaps, bytes: robotsTxt?.length ?? 0 },
    bots,
    llms: {
      found: llmsOk,
      status: llms.status === "fulfilled" ? llms.value.status : null,
      title,
      links: (llmsBody.match(/\]\((https?:\/\/|\/)[^)]+\)/g) ?? []).length,
      sections: (llmsBody.match(/^##\s+/gm) ?? []).length,
      bytes: llmsBody.length,
      error: errMsg(llms),
    },
    llmsFull: { found: llmsFull.status === "fulfilled" && llmsFull.value.status === 200 && !isHtml(llmsFull.value.body) && llmsFull.value.body.trim().length > 0, status: llmsFull.status === "fulfilled" ? llmsFull.value.status : null, bytes: llmsFull.status === "fulfilled" && llmsFull.value.status === 200 ? llmsFull.value.body.length : 0 },
    homepage,
  };
}
