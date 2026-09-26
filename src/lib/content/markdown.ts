/** Minimal, safe Markdown → HTML conversion for exports (client-safe). Raw HTML is escaped. */

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function safeHref(url: string) {
  const u = url.trim();
  return /^(https?:\/\/|mailto:|\/|#|\.)/i.test(u) ? escapeHtml(u) : "#";
}

function inline(s: string) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => `<img src="${safeHref(src)}" alt="${alt}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, text, href) => `<a href="${safeHref(href)}">${text}</a>`);
  out = out.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return out;
}

export function markdownToHtml(md: string) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;
  const flushPara = () => {
    if (para.length) html.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.type}>\n${list.items.map((i) => `  <li>${inline(i)}</li>`).join("\n")}\n</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (fence) {
        html.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        flushAll();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flushAll();
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushAll();
      html.push("<hr>");
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const type = ul ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  if (fence) html.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  flushAll();
  return html.join("\n");
}

/** Complete standalone HTML document for downloads. */
export function htmlDocument(title: string, bodyHtml: string, description?: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ""}<style>
body{font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1d2433}
h1,h2,h3{line-height:1.25}img{max-width:100%}code{background:#f2f4f7;padding:1px 4px;border-radius:4px}
pre{background:#f2f4f7;padding:12px;overflow:auto}blockquote{border-left:3px solid #d0d5dd;margin:0;padding-left:14px;color:#475467}
table{border-collapse:collapse}td,th{border:1px solid #e4e7ec;padding:6px 10px;text-align:left}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
