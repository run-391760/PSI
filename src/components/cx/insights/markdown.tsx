import type { ReactNode } from "react";

/**
 * Minimal, safe markdown for AI answers (server-safe, no HTML injection): headings, bullet and numbered
 * lists, tables, bold, italics, inline code and http(s) links. Anything else renders as plain text.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-text">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-surface-3 px-1 text-[12.5px]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(t)!;
      out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">{label}</a>);
    } else if (t.startsWith("http")) out.push(<a key={k} href={t} target="_blank" rel="noopener noreferrer" className="break-all text-link hover:underline">{t}</a>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="scroll-thin overflow-x-auto">
          <table className="my-1 w-full text-[12.5px]">
            <thead><tr>{head.map((h, j) => <th key={j} className="border-b border-border px-2 py-1 text-left font-semibold text-text-2">{inline(h, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-border px-2 py-1 tabular-nums">{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={k} className="mt-1 text-[13.5px] font-semibold text-text">{inline(h[2], k)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={k} className={ordered ? "list-decimal space-y-0.5 pl-5" : "list-disc space-y-0.5 pl-5"}>{items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
  }
  return <div className="space-y-2 text-[13.5px] leading-relaxed [overflow-wrap:anywhere] text-text">{blocks}</div>;
}
