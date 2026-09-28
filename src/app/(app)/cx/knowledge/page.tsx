import { BookOpen, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { countView, listArticles, listCategories, rankArticles, type KbArticle } from "@/lib/cx/insights/kb";
import { dateLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { ArticleButton, CategoryManager } from "@/components/cx/insights/kb-client";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ searchParams }: PageProps<"/cx/knowledge">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Knowledge base" />;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const articleId = typeof sp.article === "string" ? sp.article : "";
  const [cats, articles] = await Promise.all([listCategories(brand.id), listArticles(brand.id)]);
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;
  const writer = brand.role !== "viewer";
  const article = articleId ? articles.find((a) => a.id === articleId) ?? null : null;
  if (article) await countView(brand.id, article.id);
  const inCat = (a: KbArticle) => !cat || a.category_id === cat || cats.find((c) => c.id === a.category_id)?.parent_id === cat;
  const hits = q ? rankArticles(q, articles.filter(inCat), 50) : null;
  const shown = hits ? hits.map((h) => ({ a: articles.find((x) => x.id === h.id)!, snippet: h.snippet })) : articles.filter(inCat).map((a) => ({ a, snippet: a.body.replace(/\s+/g, " ").slice(0, 200) }));
  const h = (extra: Record<string, string | undefined>) => cxHref("/cx/knowledge", brand.id, extra);
  const catsForClient = cats.map((c) => ({ id: c.id, parent_id: c.parent_id, name: c.name, articles: c.articles }));
  const top = cats.filter((c) => !c.parent_id);

  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Knowledge base", href: article ? h({}) : undefined }, ...(article ? [{ label: article.title }] : [])]}
        title="Knowledge base"
        subject={brand.name}
        description="Internal articles for agents. Published articles ground AI reply suggestions, with the sources shown to the agent."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge>{num(articles.filter((a) => a.status === "published").length)} published</Badge>
            {articles.some((a) => a.status === "draft") && <Badge tone="warning">{num(articles.filter((a) => a.status === "draft").length)} drafts</Badge>}
          </BrandMeta>
        }
        actions={writer ? <ArticleButton brand={brand.id} cats={catsForClient} defaultCategory={cat || null} /> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="Categories" actions={writer ? <CategoryManager brand={brand.id} cats={catsForClient} /> : undefined} />
          <CardBody className="pt-0">
            <nav className="space-y-0.5 text-[13px]" aria-label="Categories">
              <Link href={h({ q: q || undefined })} className={cn("flex justify-between rounded px-2 py-1", !cat ? "bg-brand-soft font-medium text-text" : "text-text-2 hover:bg-surface-3")}>
                All articles <span className="text-text-3">{articles.length}</span>
              </Link>
              {top.map((p) => (
                <div key={p.id}>
                  <Link href={h({ cat: p.id, q: q || undefined })} className={cn("flex justify-between rounded px-2 py-1", cat === p.id ? "bg-brand-soft font-medium text-text" : "text-text-2 hover:bg-surface-3")}>
                    {p.name} <span className="text-text-3">{articles.filter((a) => a.category_id === p.id || cats.find((c) => c.id === a.category_id)?.parent_id === p.id).length}</span>
                  </Link>
                  {cats.filter((c) => c.parent_id === p.id).map((c) => (
                    <Link key={c.id} href={h({ cat: c.id, q: q || undefined })} className={cn("ml-3 flex justify-between rounded px-2 py-1", cat === c.id ? "bg-brand-soft font-medium text-text" : "text-text-2 hover:bg-surface-3")}>
                      {c.name} <span className="text-text-3">{c.articles}</span>
                    </Link>
                  ))}
                </div>
              ))}
              {!cats.length && <p className="px-2 py-1 text-[12px] text-text-3">No categories yet.</p>}
            </nav>
          </CardBody>
        </Card>
        <div className="min-w-0 space-y-4">
          {article ? (
            <Card>
              <CardHeader
                title={article.title}
                description={`${article.category ?? "Uncategorized"} · updated ${dateLabel(article.updated_at)}${article.author ? ` by ${article.author}` : ""} · ${num(article.views + 1)} views`}
                actions={writer ? <ArticleButton brand={brand.id} cats={catsForClient} article={{ id: article.id, title: article.title, body: article.body, category_id: article.category_id, tags: article.tags, status: article.status }} variant="secondary" /> : undefined}
              />
              <CardBody className="pt-1">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {article.status === "draft" && <Badge tone="warning">Draft</Badge>}
                  {article.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                </div>
                <div className="max-w-3xl space-y-3 text-[14px] leading-relaxed text-text">
                  {article.body.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
                </div>
              </CardBody>
            </Card>
          ) : (
            <>
              <form action="/cx/knowledge" className="flex gap-2" role="search">
                <input type="hidden" name="brand" value={brand.id} />
                {cat && <input type="hidden" name="cat" value={cat} />}
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-text-3" />
                  <Input name="q" defaultValue={q} placeholder="Search articles (e.g. refund policy)" className="pl-8" aria-label="Search articles" />
                </div>
              </form>
              <Card>
                <CardHeader title={q ? `${shown.length} result${shown.length === 1 ? "" : "s"} for “${q}”` : `${catName(cat) ?? "All articles"} (${shown.length})`} description={q ? "Ranked by relevance (title, tags, then body)" : undefined} />
                <CardBody className="pt-0">
                  {shown.length === 0 ? (
                    <EmptyState icon={<BookOpen className="h-5 w-5" />} title={q ? "No matching articles" : "No articles yet"} description={q ? "Try other words, or write the article agents are looking for." : "Write articles for common questions: policies, how-tos, troubleshooting. Agents search them here and AI replies cite them."} action={writer ? <ArticleButton brand={brand.id} cats={catsForClient} defaultCategory={cat || null} /> : undefined} />
                  ) : (
                    <div className="divide-y divide-border">
                      {shown.map(({ a, snippet }) => (
                        <Link key={a.id} href={h({ article: a.id })} className="block py-3 hover:bg-surface-2">
                          <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-text">
                            {a.title}
                            {a.status === "draft" && <Badge tone="warning">Draft</Badge>}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-text-2">{snippet}</p>
                          <div className="mt-1 text-[11.5px] text-text-3">{a.category ?? "Uncategorized"} · updated {dateLabel(a.updated_at)} · {num(a.views)} views</div>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
