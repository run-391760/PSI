import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CHECK_MAP } from "@/lib/site-audit/checks";
import { pageDetail, pageTable } from "@/lib/site-audit/data";
import { UrlDrawer } from "@/components/site-audit/drawer";
import { PagesExplorer, type PagesFilter } from "@/components/site-audit/pages-explorer";
import { fmtBytes, fmtMs, HttpStatus, KeyValue, pathOf, SeverityIcon, shortUrl } from "@/components/site-audit/ui";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import type { AuditCtx } from "./context";

export async function PagesView({ ctx }: { ctx: AuditCtx }) {
  const { crawl, sp, href } = ctx;
  if (crawl.details_pruned)
    return (
      <Card>
        <div className="p-4">
          <Callout tone="warning">Page-level details of this older crawl were pruned. Open a recent crawl to explore pages.</Callout>
        </div>
      </Card>
    );
  const pageId = sp.page ? Number(sp.page) : null;
  const [rows, detail] = await Promise.all([pageTable(crawl.id), pageId ? pageDetail(crawl.id, pageId) : null]);
  const initial: PagesFilter = { status: sp.status ?? "all", issues: sp.issues ?? "all", depth: sp.depth ?? "all", index: sp.index ?? "all" };
  return (
    <>
      <Card>
        <CardHeader title="Crawled pages" description={`${rows.length.toLocaleString()} URLs from the crawl of ${new Date(crawl.started_at).toUTCString().slice(0, 22)} UTC · click a page for every recorded field`} />
        <PagesExplorer rows={rows} initial={initial} exportHref={`/api/site-audit/export?crawl=${crawl.id}&type=pages`} />
      </Card>
      {detail && (
        <UrlDrawer
          title={pathOf(detail.page.url)}
          subtitle={
            <>
              <HttpStatus status={detail.page.status} blocked={!!detail.page.blocked} />
              {detail.page.indexable ? <Badge tone="good">Indexable</Badge> : <Badge>Non-indexable</Badge>}
              {detail.page.in_sitemap && <Badge tone="info">In sitemap</Badge>}
              <span className="break-all">{shortUrl(detail.page.url)}</span>
            </>
          }
          actions={
            <a href={detail.page.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          }
        >
          <PageDetailBody d={detail} issueHref={(id) => href({ tab: "issues", issue: id })} pageHref={(id) => href({ ...pick(sp), tab: "pages", page: id })} />
        </UrlDrawer>
      )}
    </>
  );
}
const pick = (sp: Record<string, string | undefined>) => ({ status: sp.status, issues: sp.issues, depth: sp.depth, index: sp.index });

function Section({ title, children, count }: { title: string; children: ReactNode; count?: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 flex items-center gap-2 border-b border-border pb-1.5 text-[13px] font-semibold text-text">
        {title}
        {count != null && <span className="rounded bg-surface-3 px-1.5 text-[11px] font-medium text-text-2">{count}</span>}
      </h3>
      {children}
    </section>
  );
}
const len = (s: string | null | undefined) => (s ? <span className="text-text-3"> · {s.length} chars</span> : null);

type Detail = NonNullable<Awaited<ReturnType<typeof pageDetail>>>;
function PageDetailBody({ d, issueHref, pageHref }: { d: Detail; issueHref: (id: string) => string; pageHref: (id: number) => string }) {
  const p = d.page;
  const data = p.data;
  const h = data.html;
  const hd = data.headers;
  const internalOut = d.outlinks.filter((l) => l.internal);
  const externalOut = d.outlinks.filter((l) => !l.internal);
  return (
    <div>
      <Section title="Issues on this page" count={d.issues.length}>
        {d.issues.length === 0 ? (
          <p className="text-[13px] text-good-ink">No issues found on this page.</p>
        ) : (
          <ul className="space-y-1.5">
            {d.issues.map((i, k) => {
              const c = CHECK_MAP[i.check_id];
              if (!c) return null;
              return (
                <li key={k} className="flex items-start gap-2 text-[13px]">
                  <SeverityIcon severity={c.severity} className="mt-0.5" />
                  <div className="min-w-0">
                    <Link href={issueHref(c.id)} className="text-text hover:text-link hover:underline">
                      {c.title}
                    </Link>
                    {i.detail && <div className="text-[12px] text-text-3 [overflow-wrap:anywhere]">{i.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Response">
        <KeyValue
          items={[
            { label: "HTTP status", value: p.status == null ? "Not requested (blocked by robots.txt)" : p.status === 0 ? `No response — ${p.error ?? "error"}` : p.status },
            { label: "Final URL", value: p.final_url && p.final_url !== p.url ? <span className="break-all">{data.resolvedFinal ?? p.final_url}</span> : "Same as requested" },
            {
              label: "Redirect chain",
              value: data.redirectChain.length ? (
                <ol className="space-y-0.5">
                  {data.redirectChain.map((s, i) => (
                    <li key={i} className="break-all">
                      <span className="tabular mr-1.5 rounded bg-info-soft px-1 text-[11px] text-link">{s.status}</span>
                      {s.url}
                    </li>
                  ))}
                  <li className="break-all text-text-2">→ {data.resolvedFinal ?? p.final_url}</li>
                </ol>
              ) : (
                "None"
              ),
            },
            { label: "Content type", value: p.content_type },
            { label: "Download time", value: `${fmtMs(p.response_ms)}${data.ttfbMs != null ? ` (TTFB ${fmtMs(data.ttfbMs)})` : ""}` },
            { label: "HTML size", value: `${fmtBytes(p.size_bytes)}${data.transferBytes ? ` · ${fmtBytes(data.transferBytes)} transferred` : ""}${data.truncated ? " · truncated" : ""}` },
            { label: "Compression", value: hd?.encoding ?? (p.status && p.status < 300 ? "None" : null) },
            { label: "Crawl depth", value: p.depth == null ? "Not linked (found in sitemap)" : `${p.depth} click${p.depth === 1 ? "" : "s"} from the start page` },
            { label: "Discovered via", value: `${{ start: "Start URL", link: "Internal link", sitemap: "XML sitemap", redirect: "Redirect" }[data.source] ?? data.source}${data.foundOn ? ` · ${data.foundOn}` : ""}` },
            { label: "Server", value: hd?.server },
            { label: "Cache-Control", value: hd?.cacheControl },
            { label: "Last-Modified", value: hd?.lastModified },
          ]}
        />
      </Section>

      {h && (
        <>
          <Section title="Search appearance">
            <div className="mb-3 rounded-md border border-border p-3">
              <div className="truncate text-[12px] text-text-3">{shortUrl(p.url)}</div>
              <div className="mt-0.5 text-[16px] leading-snug text-link">{h.title || <span className="text-text-3 italic">No title</span>}</div>
              <div className="mt-0.5 line-clamp-2 text-[12.5px] text-text-2">{h.description || <span className="text-text-3 italic">No meta description — search engines will pick a snippet.</span>}</div>
            </div>
            <KeyValue
              items={[
                { label: "Title", value: h.title ? <>{h.title}{len(h.title)}</> : null },
                { label: "Meta description", value: h.description ? <>{h.description}{len(h.description)}</> : null },
                { label: `H1 (${h.h1.length})`, value: h.h1.length ? h.h1.slice(0, 5).join(" · ") : null },
                { label: `H2 (${h.h2.length})`, value: h.h2.length ? h.h2.slice(0, 8).join(" · ") : null },
                { label: "Canonical", value: h.canonicals.length ? h.canonicals.map((c) => (c.startsWith("invalid:") ? `invalid: “${c.slice(8)}”` : c === p.url ? `${c} (self)` : c)).join(" · ") : null },
                { label: "Meta robots", value: h.metaRobots || "Not set (index, follow)" },
                { label: "X-Robots-Tag", value: hd?.xRobots },
                { label: "Language", value: h.lang },
                { label: "Viewport", value: h.viewport },
                { label: "Charset", value: h.charset },
                { label: "Doctype", value: h.doctype ? "<!DOCTYPE html>" : "Missing" },
                { label: "Meta refresh", value: h.metaRefresh },
              ]}
            />
          </Section>

          <Section title="Content">
            <KeyValue
              items={[
                { label: "Word count", value: h.wordCount.toLocaleString() },
                { label: "Text / HTML ratio", value: `${h.textRatio}%` },
                { label: "Images", value: `${h.images} · ${h.imagesMissingAlt} without alt` },
                { label: "Missing alt (sample)", value: h.missingAltSamples.length ? <span className="break-all">{h.missingAltSamples.slice(0, 3).join(" · ")}</span> : null },
                { label: "Scripts / stylesheets", value: `${h.scripts} / ${h.stylesheets}` },
                { label: "Iframes", value: h.iframes },
                { label: "Content hash", value: <span className="font-mono text-[11.5px]">{h.contentHash.slice(0, 16)} · simhash {h.simhash}</span> },
                { label: "Mixed content", value: h.mixedContent.length ? <span className="break-all">{h.mixedContent.slice(0, 5).join(" · ")}</span> : "None" },
              ]}
            />
          </Section>

          <Section title="Structured data & social">
            <KeyValue
              items={[
                { label: "JSON-LD blocks", value: h.jsonLd.count },
                { label: "Schema types", value: h.jsonLd.types.length ? <span className="flex flex-wrap gap-1">{h.jsonLd.types.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}</span> : null },
                { label: "JSON-LD errors", value: h.jsonLd.errors.length ? <span className="text-critical-ink">{h.jsonLd.errors.join(" · ")}</span> : "None" },
                { label: "Microdata", value: h.microdata.length ? h.microdata.join(", ") : null },
                ...Object.entries(h.og).slice(0, 8).map(([k, v]) => ({ label: `og:${k}`, value: <span className="break-all">{v}</span> })),
                ...Object.entries(h.twitter).slice(0, 6).map(([k, v]) => ({ label: `twitter:${k}`, value: <span className="break-all">{v}</span> })),
              ]}
            />
            {!Object.keys(h.og).length && <p className="mt-1 text-[12px] text-text-3">No Open Graph tags.</p>}
          </Section>

          {h.hreflang.length > 0 && (
            <Section title="hreflang" count={h.hreflang.length}>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {h.hreflang.map((x, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="w-24 py-1 pr-2 font-mono text-text">{x.lang}</td>
                      <td className="py-1 break-all text-text-2">{x.href ?? x.raw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title="Security headers">
            <KeyValue
              items={[
                { label: "Strict-Transport-Security", value: hd?.hsts },
                { label: "Content-Security-Policy", value: hd?.csp ? <span className="line-clamp-2 break-all">{hd.csp}</span> : null },
                { label: "X-Content-Type-Options", value: hd?.xcto },
                { label: "X-Frame-Options", value: hd?.xfo },
                { label: "Referrer-Policy", value: hd?.referrer },
              ]}
            />
          </Section>
        </>
      )}

      <Section title="Outgoing links" count={`${internalOut.length} internal · ${externalOut.length} external`}>
        {h && (
          <p className="mb-2 text-[12px] text-text-3">
            {h.internalLinks} internal and {h.externalLinks} external &lt;a&gt; links ({h.nofollowInternal + h.nofollowExternal} nofollow, {h.emptyAnchors} without anchor text).
          </p>
        )}
        {d.outlinks.length ? (
          <div className="scroll-thin max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-[12.5px]">
              <tbody>
                {d.outlinks.slice(0, 300).map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="w-14 px-2 py-1">
                      <HttpStatus status={l.status} />
                    </td>
                    <td className="min-w-0 px-2 py-1">
                      {l.target_id ? (
                        <Link href={pageHref(l.target_id)} scroll={false} className="block truncate text-link hover:underline" title={l.target}>
                          {shortUrl(l.target)}
                        </Link>
                      ) : (
                        <a href={l.target} target="_blank" rel="noopener noreferrer" className="block truncate text-text-2 hover:text-link" title={l.target}>
                          {shortUrl(l.target)}
                        </a>
                      )}
                      <div className="truncate text-[11.5px] text-text-3">{l.anchor || "(no anchor text)"}</div>
                    </td>
                    <td className="w-24 px-2 py-1 text-right text-[11.5px] text-text-3">
                      {l.internal ? "Internal" : "External"}
                      {l.rel && <div className={l.nofollow ? "text-warning-ink" : "text-text-3"}>rel=&quot;{l.rel}&quot;</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12.5px] text-text-3">No links recorded.</p>
        )}
      </Section>

      <Section title="Incoming internal links" count={p.inlinks}>
        {d.inlinks.length ? (
          <ul className="scroll-thin max-h-60 space-y-1 overflow-y-auto text-[12.5px]">
            {d.inlinks.map((l, i) => (
              <li key={i} className="min-w-0">
                <Link href={pageHref(l.id)} scroll={false} className="block truncate text-link hover:underline" title={l.url}>
                  {shortUrl(l.url)}
                </Link>
                <div className="truncate text-[11.5px] text-text-3">
                  {l.anchor || "(no anchor text)"}
                  {l.rel ? ` · rel="${l.rel}"` : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-text-3">No crawled page links here directly{p.inlinks ? " (links arrive via redirects)" : ""}.</p>
        )}
      </Section>
    </div>
  );
}
