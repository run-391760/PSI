"use client";

import { Link2, Map as MapIcon, RefreshCw, Save, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkLinksAction, checkLiveAction, loadSitemapAction, researchAction, updateSettingsAction } from "@/app/(app)/optimizer/actions";
import { IntentBadges, KdBadge } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { compact, money, num, pct, timeAgo } from "@/lib/format";
import { FORMAT_LABEL } from "@/lib/optimizer/intent";
import { gscFor } from "@/lib/optimizer/signals";
import type { Draft, DraftMeta, GscPerformance, KeywordData, LinkCheck, LiveCheck, Research } from "@/lib/optimizer/types";
import { flashScore } from "../score-flash";

type Patch = Parameters<typeof updateSettingsAction>[1];

function useSaver(draftId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Patch, note: string) => {
    setBusy(true);
    const r = await updateSettingsAction(draftId, patch, note);
    setBusy(false);
    if (r.ok) flashScore({ title: note, before: r.data.before, after: r.data.after, status: r.data.status });
    else flashScore({ title: "Not saved", detail: r.error, error: true });
    router.refresh();
  };
  return { busy, save };
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-2.5 py-2">
      <div className="truncate text-[11.5px] text-text-3">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-text tabular-nums">{value}</div>
      {sub && <div className="truncate text-[11.5px] text-text-3">{sub}</div>}
    </div>
  );
}

/** DataForSEO Labs metrics of the primary keyword (same source as Keyword Overview). */
function KeywordDataBlock({ data, stale }: { data: KeywordData; stale: boolean }) {
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <h3 className="text-[12px] font-semibold tracking-wide text-text-3 uppercase">Keyword data</h3>
        <Badge tone="info">DataForSEO</Badge>
        <span className="text-[12px] text-text-3">
          “{data.keyword}” · {data.db} · {timeAgo(data.fetchedAt)}
          {stale && " · for an earlier keyword: re-run research"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Search volume" value={data.volume == null ? "n/a" : num(data.volume)} sub="Monthly, Google" />
        <Stat label="Keyword difficulty" value={<KdBadge kd={data.kd == null ? null : Math.round(data.kd)} />} />
        <Stat label="CPC" value={money(data.cpc)} sub={data.competition == null ? undefined : `Competition ${data.competition.toFixed(2)}`} />
        <Stat label="Intent" value={data.intents.length ? <IntentBadges intents={data.intents} /> : "n/a"} sub={data.intents.length ? "Used as an intent signal" : undefined} />
      </div>
    </section>
  );
}

/** Search Console performance of the draft URL (last 28 days) for a project linked to Search Console. */
function GscBlock({ data, current }: { data: GscPerformance; current: boolean }) {
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <h3 className="text-[12px] font-semibold tracking-wide text-text-3 uppercase">Search Console</h3>
        <Badge tone="good">Your data</Badge>
        <span className="min-w-0 truncate text-[12px] text-text-3">
          {data.project.name} · {data.start} – {data.end}
          {!current && " · for a different URL: re-run research"}
        </span>
      </div>
      {data.page ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Clicks" value={compact(data.page.clicks)} />
          <Stat label="Impressions" value={compact(data.page.impressions)} />
          <Stat label="CTR" value={pct(data.page.ctr * 100)} />
          <Stat label="Avg. position" value={data.page.position.toFixed(1)} />
        </div>
      ) : (
        <p className="text-[12.5px] text-text-3">No Search Console data for {data.url} in the last 28 days (not published or not indexed yet).</p>
      )}
      {data.queries.length > 0 && (
        <div className="scroll-thin mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[12.5px]">
            <thead className="text-left text-text-3">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-2 font-medium">Query the page ranks for</th>
                <th className="py-1.5 pr-2 text-right font-medium">Clicks</th>
                <th className="py-1.5 pr-2 text-right font-medium">Impr.</th>
                <th className="py-1.5 pr-2 text-right font-medium">CTR</th>
                <th className="py-1.5 text-right font-medium">Pos.</th>
              </tr>
            </thead>
            <tbody>
              {data.queries.slice(0, 10).map((q) => (
                <tr key={q.query} className="border-b border-border last:border-0">
                  <td className="max-w-[260px] truncate py-1.5 pr-2 text-text">{q.query}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{num(q.clicks)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{num(q.impressions)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{pct(q.ctr * 100)}</td>
                  <td className="py-1.5 text-right tabular-nums">{q.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Search Intent: competitor URLs + SERP research results (live SERP, crawled pages, autocomplete). */
export function ResearchPanel({ draft, research, serpOn }: { draft: Draft; research: Research | null; serpOn: boolean }) {
  const router = useRouter();
  const [urls, setUrls] = useState((draft.meta.competitors ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await researchAction(draft.id, urls.split(/\s+/).filter(Boolean).slice(0, 10));
    setBusy(false);
    if (r.ok) flashScore({ title: `Research done: ${r.data.competitors} pages analyzed`, detail: r.data.notes.join("\n") || undefined });
    else flashScore({ title: "Research failed", detail: r.error, error: true });
    router.refresh();
  };
  const comps = research?.competitors ?? [];
  return (
    <Card>
      <CardHeader
        title="SERP research"
        description={`${serpOn ? "Live Google top results and keyword metrics (DataForSEO) are fetched automatically; add extra competitor URLs if you like." : "Live SERP data needs DataForSEO. Add 2–5 URLs of pages that rank for your keyword: they are crawled and compared."} Search Console data is added when the article URL belongs to a project linked to Search Console.`}
        actions={research ? <span className="text-[12px] text-text-3">Updated {timeAgo(research.fetchedAt)}</span> : undefined}
      />
      <CardBody className="space-y-3">
        <Field label="Competitor URLs" hint="One per line (max 10). Pages are fetched politely and robots.txt is respected.">
          <Textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder={"https://competitor.com/blog/topic\nhttps://another.edu/guide"} />
        </Field>
        <Button variant="primary" loading={busy} onClick={run}>
          {!busy && <Search className="h-4 w-4" />} {research ? "Re-run research" : "Run research"}
        </Button>
        {research && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              <Badge tone={research.serpSource === "serp" ? "good" : research.serpSource === "urls" ? "info" : "neutral"}>{research.serpSource === "serp" ? "Live SERP" : research.serpSource === "urls" ? "Competitor URLs" : "No competitor pages"}</Badge>
              {research.features.map((f) => (
                <Badge key={f} tone="neutral">
                  {f.replace(/_/g, " ")}
                </Badge>
              ))}
              <Badge tone="neutral">{research.autocomplete.length} autocomplete suggestions</Badge>
              {research.paa.length > 0 && <Badge tone="neutral">{research.paa.length} People Also Ask</Badge>}
            </div>
            {research.notes.map((n) => (
              <p key={n} className="text-[12.5px] text-text-3">
                {n}
              </p>
            ))}
            {research.keywordData && <KeywordDataBlock data={research.keywordData} stale={research.keywordData.keyword.toLowerCase() !== draft.keyword.toLowerCase()} />}
            {research.gsc && <GscBlock data={research.gsc} current={!!gscFor(draft, research)} />}
            {comps.length > 0 && (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead className="text-left text-text-3">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-2 font-medium">#</th>
                      <th className="py-1.5 pr-2 font-medium">Page</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Words</th>
                      <th className="py-1.5 pr-2 font-medium">Format</th>
                      <th className="py-1.5 pr-2 text-right font-medium">H2</th>
                      <th className="py-1.5 font-medium">Has</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c) => (
                      <tr key={c.url} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-2 text-text-3">{c.position ?? "—"}</td>
                        <td className="max-w-[320px] py-1.5 pr-2">
                          <a href={c.url} target="_blank" rel="noreferrer noopener" className="block truncate text-link hover:underline">
                            {c.title || c.url}
                          </a>
                          <span className="block truncate text-text-3">{c.error ? `Not crawled: ${c.error}` : c.domain}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{c.error ? "—" : c.words.toLocaleString()}</td>
                        <td className="py-1.5 pr-2">{c.format ? FORMAT_LABEL[c.format] : "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{c.error ? "—" : c.headings.filter((h) => h.level === 2).length}</td>
                        <td className="py-1.5 text-text-3">{c.error ? "" : [c.hasFaq && "FAQ", c.tables && "tables", c.hasVideo && "video", c.images > 1 && "images", ...c.schemaTypes.slice(0, 3)].filter(Boolean).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** On-Page: how the result looks in Google, with inline editing of title, description and slug. */
export function SerpPreview({ draft }: { draft: Draft }) {
  const { busy, save } = useSaver(draft.id);
  const [f, setF] = useState({ title: draft.title, metaDescription: draft.metaDescription, slug: draft.slug });
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  let host = "example.com";
  try {
    host = draft.url ? new URL(draft.url).hostname : host;
  } catch {
    /* keep */
  }
  const t = f.title.length > 60 ? `${f.title.slice(0, 58).trimEnd()}…` : f.title || "Missing title";
  const d = f.metaDescription.length > 158 ? `${f.metaDescription.slice(0, 155).trimEnd()}…` : f.metaDescription || "Google will pick text from the page.";
  return (
    <Card>
      <CardHeader title="Search result preview" description="Edit the title, description and slug and see the snippet update." actions={<Segmented size="sm" value={device} onChange={setDevice} options={[{ value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }]} />} />
      <CardBody className="grid gap-4 lg:grid-cols-2">
        <div className={device === "mobile" ? "max-w-[360px]" : ""}>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-[12px] text-text-2">
              {host} › {f.slug || "…"}
            </div>
            <div className="mt-0.5 text-[18px] leading-snug text-link">{t}</div>
            <div className="mt-1 text-[13px] leading-snug text-text-2">{d}</div>
          </div>
        </div>
        <div className="space-y-2">
          <Field label={`SEO title (${f.title.length}/60)`}>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label={`Meta description (${f.metaDescription.length}/160)`}>
            <Textarea rows={3} value={f.metaDescription} onChange={(e) => setF({ ...f, metaDescription: e.target.value })} />
          </Field>
          <Field label="Slug">
            <Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
          </Field>
          <Button variant="primary" loading={busy} onClick={() => save(f, "Updated title, description and slug")}>
            {!busy && <Save className="h-4 w-4" />} Save & re-score
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** E-E-A-T: author, organization and dates. */
export function AuthorForm({ draft }: { draft: Draft }) {
  const { busy, save } = useSaver(draft.id);
  const m = draft.meta;
  const [a, setA] = useState({ name: m.author?.name ?? "", bio: m.author?.bio ?? "", credentials: m.author?.credentials ?? "", url: m.author?.url ?? "" });
  const [o, setO] = useState({ name: m.organization?.name ?? "", url: m.organization?.url ?? "", logo: m.organization?.logo ?? "" });
  return (
    <Card>
      <CardHeader title="Author & publisher" description="Shown to readers and used in structured data. Required for E-E-A-T on YMYL topics (education, careers, money, health)." />
      <CardBody className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Author name">
            <Input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="Dr. Priya Shah" />
          </Field>
          <Field label="Credentials / role">
            <Input value={a.credentials} onChange={(e) => setA({ ...a, credentials: e.target.value })} placeholder="Professor of Management, 12 years in admissions" />
          </Field>
        </div>
        <Field label="Author bio" hint="1–3 sentences on relevant experience.">
          <Textarea rows={2} value={a.bio} onChange={(e) => setA({ ...a, bio: e.target.value })} />
        </Field>
        <Field label="Author profile URL">
          <Input value={a.url} onChange={(e) => setA({ ...a, url: e.target.value })} placeholder="https://example.edu/faculty/priya-shah" />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Organization">
            <Input value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} placeholder="Parul University" />
          </Field>
          <Field label="Organization URL">
            <Input value={o.url} onChange={(e) => setO({ ...o, url: e.target.value })} placeholder="https://paruluniversity.ac.in" />
          </Field>
          <Field label="Logo URL">
            <Input value={o.logo} onChange={(e) => setO({ ...o, logo: e.target.value })} />
          </Field>
        </div>
        <Button variant="primary" loading={busy} onClick={() => save({ meta: { author: a, organization: o } }, "Updated author and publisher")}>
          {!busy && <Save className="h-4 w-4" />} Save & re-score
        </Button>
      </CardBody>
    </Card>
  );
}

const PAGE_TYPES: NonNullable<DraftMeta["pageType"]>[] = ["blog", "guide", "how-to", "listicle", "comparison", "review", "landing", "news", "course"];

/** Technical SEO: URL, canonical, robots, dates, page type + live URL check. */
export function TechnicalForm({ draft, live }: { draft: Draft; live: LiveCheck | null }) {
  const router = useRouter();
  const { busy, save } = useSaver(draft.id);
  const m = draft.meta;
  const [f, setF] = useState({ url: draft.url, canonical: m.canonical ?? "", robots: m.robots ?? "index, follow", publishedAt: m.publishedAt ?? "", modifiedAt: m.modifiedAt ?? "", featuredImage: m.featuredImage ?? "", pageType: m.pageType ?? "" });
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    const r = await checkLiveAction(draft.id);
    setChecking(false);
    if (r.ok) flashScore({ title: r.data.error ? `Live check: ${r.data.error}` : `Live URL answered HTTP ${r.data.status}`, error: !!r.data.error });
    else flashScore({ title: "Live check failed", detail: r.error, error: true });
    router.refresh();
  };
  return (
    <Card>
      <CardHeader title="Publishing settings" description="Where the article will live and how search engines may index it." />
      <CardBody className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Article URL">
            <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.com/blog/article" />
          </Field>
          <Field label="Canonical URL" hint="Usually the article URL itself.">
            <Input value={f.canonical} onChange={(e) => setF({ ...f, canonical: e.target.value })} />
          </Field>
          <Field label="Robots meta">
            <Select value={f.robots} onChange={(e) => setF({ ...f, robots: e.target.value })}>
              {["index, follow", "index, nofollow", "noindex, follow", "noindex, nofollow"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Page type" hint="Drives schema recommendations.">
            <Select value={f.pageType} onChange={(e) => setF({ ...f, pageType: e.target.value })}>
              <option value="">Detect automatically</option>
              {PAGE_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Published date">
            <Input type="date" value={f.publishedAt.slice(0, 10)} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} />
          </Field>
          <Field label="Last updated date">
            <Input type="date" value={f.modifiedAt.slice(0, 10)} onChange={(e) => setF({ ...f, modifiedAt: e.target.value })} />
          </Field>
        </div>
        <Field label="Featured image URL">
          <Input value={f.featuredImage} onChange={(e) => setF({ ...f, featuredImage: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={busy}
            onClick={() => save({ url: f.url, meta: { canonical: f.canonical, robots: f.robots, publishedAt: f.publishedAt || undefined, modifiedAt: f.modifiedAt || undefined, featuredImage: f.featuredImage, pageType: (f.pageType || undefined) as DraftMeta["pageType"] } }, "Updated publishing settings")}
          >
            {!busy && <Save className="h-4 w-4" />} Save & re-score
          </Button>
          <Button loading={checking} disabled={!draft.url} onClick={check} title={draft.url ? "Fetch the published URL: status, robots.txt, noindex, X-Robots-Tag, canonical, PageSpeed" : "Set and save the article URL first"}>
            {!checking && <RefreshCw className="h-4 w-4" />} Check live URL
          </Button>
        </div>
        {live && (
          <div className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-text-2">
            Live check {timeAgo(live.checkedAt)}: {live.error ? <span className="text-critical-ink">{live.error}</span> : `HTTP ${live.status}`}
            {live.noindex && <span className="text-critical-ink"> · noindex</span>}
            {live.xRobots && ` · X-Robots-Tag: ${live.xRobots}`}
            {live.robotsAllowed != null && ` · robots.txt ${live.robotsAllowed ? "allows" : "blocks"} Googlebot`}
            {live.canonical && ` · canonical ${live.canonical}`}
            {live.pagespeed && ` · PageSpeed (mobile) ${live.pagespeed.performance ?? "n/a"}${live.pagespeed.lcp != null ? `, LCP ${(live.pagespeed.lcp / 1000).toFixed(1)}s` : ""}${live.pagespeed.cls != null ? `, CLS ${live.pagespeed.cls.toFixed(2)}` : ""}`}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Conversion: reader stage and the call to action used by the CTA fixes. */
export function CtaForm({ draft }: { draft: Draft }) {
  const { busy, save } = useSaver(draft.id);
  const [f, setF] = useState({ funnel: draft.meta.funnel ?? "", text: draft.meta.cta?.text ?? "", url: draft.meta.cta?.url ?? "" });
  return (
    <Card>
      <CardHeader title="Conversion settings" description="The next step you want readers to take. The CTA fix inserts it into the article." />
      <CardBody className="grid gap-3 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
        <Field label="Reader stage">
          <Select value={f.funnel} onChange={(e) => setF({ ...f, funnel: e.target.value })}>
            <option value="">From search intent</option>
            <option value="awareness">Awareness</option>
            <option value="consideration">Consideration</option>
            <option value="decision">Decision</option>
          </Select>
        </Field>
        <Field label="CTA text">
          <Input value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Download the MBA brochure" />
        </Field>
        <Field label="CTA link">
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.edu/mba/brochure" />
        </Field>
        <Button variant="primary" loading={busy} onClick={() => save({ meta: { funnel: (f.funnel || undefined) as DraftMeta["funnel"], cta: { text: f.text, url: f.url } } }, "Updated conversion settings")}>
          {!busy && <Save className="h-4 w-4" />} Save
        </Button>
      </CardBody>
    </Card>
  );
}

/** Links & UX: check every outbound link for errors. */
export function LinkCheckPanel({ draftId, links }: { draftId: string; links: LinkCheck | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const broken = links?.results.filter((r) => r.error || (r.status ?? 0) >= 400) ?? [];
  return (
    <Card>
      <CardHeader title="Broken link check" description="Requests every outbound link (HEAD, then GET when needed) and records its status." actions={links ? <span className="text-[12px] text-text-3">Checked {timeAgo(links.checkedAt)}</span> : undefined} />
      <CardBody className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await checkLinksAction(draftId);
            setBusy(false);
            if (r.ok) flashScore({ title: `Checked ${r.data.checked} links: ${r.data.broken} broken`, error: r.data.broken > 0 });
            else flashScore({ title: "Link check failed", detail: r.error, error: true });
            router.refresh();
          }}
        >
          {!busy && <Link2 className="h-4 w-4" />} Check links
        </Button>
        {links && (
          <span className="text-[13px] text-text-2">
            {links.results.length} checked · <span className={broken.length ? "text-critical-ink" : "text-good-ink"}>{broken.length} broken</span>
          </span>
        )}
      </CardBody>
    </Card>
  );
}

/** Internal Linking: the site's pages (from a sitemap or pasted) that the opportunity finder matches. */
export function SitePagesPanel({ draft }: { draft: Draft }) {
  const router = useRouter();
  const { busy, save } = useSaver(draft.id);
  const [sitemap, setSitemap] = useState(draft.meta.sitemapUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState("");
  const pages = draft.meta.sitePages ?? [];
  return (
    <Card>
      <CardHeader title="Your site's pages" description={`${pages.length} pages known. Load your XML sitemap or paste pages as “URL | Title” lines. Your other drafts with a URL are included automatically.`} />
      <CardBody className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Sitemap URL" className="flex-1">
            <Input value={sitemap} onChange={(e) => setSitemap(e.target.value)} placeholder="https://example.com/sitemap.xml" />
          </Field>
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              const r = await loadSitemapAction(draft.id, sitemap);
              setLoading(false);
              if (r.ok) flashScore({ title: `Loaded ${r.data.pages} pages from the sitemap` });
              else flashScore({ title: "Sitemap not loaded", detail: r.error, error: true });
              router.refresh();
            }}
          >
            {!loading && <MapIcon className="h-4 w-4" />} Load sitemap
          </Button>
        </div>
        <Field label="Add pages manually">
          <Textarea rows={3} value={manual} onChange={(e) => setManual(e.target.value)} placeholder={"https://example.com/mba-fees | MBA fees and scholarships\nhttps://example.com/placements | Placement records"} />
        </Field>
        <Button
          loading={busy}
          disabled={!manual.trim()}
          onClick={() => {
            const add = manual
              .split("\n")
              .map((l) => l.split("|").map((x) => x.trim()))
              .filter(([u]) => /^https?:\/\//.test(u ?? ""))
              .map(([u, t]) => ({ url: u, title: t || u.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") || u }));
            const merged = [...pages.filter((p) => !add.some((a) => a.url === p.url)), ...add].slice(0, 500);
            setManual("");
            void save({ meta: { sitePages: merged } }, `Added ${add.length} site pages`);
          }}
        >
          Add pages
        </Button>
        {pages.length > 0 && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-link">Show {pages.length} pages</summary>
            <ul className="scroll-thin mt-2 max-h-56 overflow-y-auto">
              {pages.map((p) => (
                <li key={p.url} className="truncate text-text-2">
                  {p.title} — <span className="text-text-3">{p.url}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
