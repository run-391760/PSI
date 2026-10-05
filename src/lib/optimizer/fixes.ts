import { isConclusionHeading } from "./parse";
import type { DraftInput, Fix, InsertPosition } from "./types";

/**
 * Applies a fix to a draft (pure). Returns the new draft and whether anything changed, so the server
 * can re-score and record the revision, and the UI can say when a fix no longer applies.
 */

export type ApplyResult = { draft: DraftInput; changed: boolean; notes: string[] };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const plain = (s: string) => s.replace(/[*_`[\]()#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function insertLines(body: string, markdown: string, position: InsertPosition): { body: string; ok: boolean } {
  const lines = body.split("\n");
  const block = markdown.trim().split("\n");
  const headingAt = (i: number) => HEADING.exec(lines[i] ?? "");
  let at = lines.length;
  if (position === "start") at = 0;
  else if (position === "after-h1") {
    const h1 = lines.findIndex((l) => /^\s{0,3}#\s/.test(l));
    at = h1 >= 0 ? h1 + 1 : 0;
  } else if (position === "after-intro" || position === "before-conclusion" || position === "end") {
    const h2 = lines.findIndex((l) => /^\s{0,3}##\s/.test(l));
    if (position === "after-intro") at = h2 >= 0 ? h2 : lines.length;
    else if (position === "end") at = lines.length;
    else {
      const idx = lines.map((l, i) => ({ l, i })).filter(({ l }) => {
        const m = HEADING.exec(l);
        return m && m[1].length === 2 && isConclusionHeading(m[2]);
      });
      at = idx.length ? idx[idx.length - 1].i : lines.length;
    }
  } else {
    const target = plain(position.afterHeading);
    const hi = lines.findIndex((l) => {
      const m = HEADING.exec(l);
      return m && plain(m[2]) === target;
    });
    if (hi < 0) return { body, ok: false };
    const level = headingAt(hi)![1].length;
    at = lines.length;
    for (let i = hi + 1; i < lines.length; i++) {
      const m = headingAt(i);
      if (m && m[1].length <= level) {
        at = i;
        break;
      }
    }
  }
  // Keep blank lines around the inserted block.
  const before = lines.slice(0, at);
  const after = lines.slice(at);
  while (before.length && !before[before.length - 1].trim()) before.pop();
  while (after.length && !after[0].trim()) after.shift();
  const out = [...before, ...(before.length ? [""] : []), ...block, ...(after.length ? [""] : []), ...after];
  return { body: out.join("\n"), ok: true };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyFix(d: DraftInput, fix: Fix): ApplyResult {
  const notes: string[] = [];
  const next: DraftInput = { ...d, meta: { ...d.meta } };
  switch (fix.kind) {
    case "set":
      next[fix.field] = fix.value;
      break;
    case "meta":
      next.meta = { ...next.meta, ...fix.patch };
      break;
    case "replace": {
      if (!fix.find || !next.body.includes(fix.find)) {
        notes.push(`Text not found: “${fix.find.slice(0, 60)}”`);
        break;
      }
      if (fix.all) next.body = next.body.split(fix.find).join(fix.replace);
      else if (fix.last) {
        const i = next.body.lastIndexOf(fix.find);
        next.body = next.body.slice(0, i) + fix.replace + next.body.slice(i + fix.find.length);
      } else next.body = next.body.replace(fix.find, () => fix.replace);
      next.body = next.body.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1");
      break;
    }
    case "insert": {
      const r = insertLines(next.body, fix.markdown, fix.position);
      if (!r.ok) notes.push("Insert position not found; added at the end.");
      next.body = r.ok ? r.body : insertLines(next.body, fix.markdown, "end").body;
      break;
    }
    case "set-h1": {
      const lines = next.body.split("\n");
      const i = lines.findIndex((l) => /^\s{0,3}#\s/.test(l));
      if (i >= 0) lines[i] = `# ${fix.text}`;
      else lines.unshift(`# ${fix.text}`, "");
      next.body = lines.join("\n");
      break;
    }
    case "link": {
      const lines = next.body.split("\n");
      const re = new RegExp(`(?<![\\p{L}\\p{N}\\[])(${escapeRe(fix.phrase)})(?![\\p{L}\\p{N}\\]])`, "iu");
      const i = lines.findIndex((l) => !HEADING.test(l) && re.test(l.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => " ".repeat(m.length))));
      if (i < 0) {
        notes.push(`Phrase not found: “${fix.phrase}”`);
        break;
      }
      // Match outside existing links only.
      const masked = lines[i].replace(/\[[^\]]*\]\([^)]*\)/g, (m) => "\u0000".repeat(m.length));
      const m = re.exec(masked)!;
      lines[i] = `${lines[i].slice(0, m.index)}[${lines[i].slice(m.index, m.index + m[0].length)}](${fix.url})${lines[i].slice(m.index + m[0].length)}`;
      next.body = lines.join("\n");
      break;
    }
    case "alt": {
      const md = new RegExp(`!\\[[^\\]]*\\]\\(\\s*<?${escapeRe(fix.src)}>?`);
      const html = new RegExp(`(<img\\b[^>]*src=["']${escapeRe(fix.src)}["'][^>]*?)(\\s+alt=["'][^"']*["'])?([^>]*>)`, "i");
      const alt = fix.alt.replace(/[[\]"]/g, "");
      if (md.test(next.body)) next.body = next.body.replace(md, (m) => m.replace(/!\[[^\]]*\]/, `![${alt}]`));
      else if (html.test(next.body)) next.body = next.body.replace(html, (_m, a, _b, c) => `${a} alt="${alt}"${c}`);
      else notes.push("Image not found.");
      break;
    }
    case "batch": {
      let cur: DraftInput = next;
      for (const f of fix.fixes) {
        const r = applyFix(cur, f);
        cur = r.draft;
        notes.push(...r.notes);
      }
      return { draft: cur, changed: JSON.stringify(cur) !== JSON.stringify(d), notes };
    }
  }
  return { draft: next, changed: JSON.stringify(next) !== JSON.stringify(d), notes };
}
