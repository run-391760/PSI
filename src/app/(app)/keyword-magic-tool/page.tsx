import { Wand2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { ideaPool, selectIdeas } from "@/lib/keywords/ideas";
import { normalizeKw } from "@/lib/keywords/text";
import { MATCH_TYPES, type MatchType } from "@/lib/keywords/types";
import { DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { LinkSegmented } from "@/components/keywords/link-tabs";
import { MagicTool } from "@/components/keywords/magic-tool";
import { SourceBadges } from "@/components/keywords/source-badges";

export const metadata: Metadata = { title: "Keyword Magic Tool" };

const EXAMPLES = ["running shoes", "seo", "credit card", "air fryer recipes", "mba colleges"];
const BREADCRUMBS = [{ label: "Keyword research" }, { label: "Keyword Magic Tool", href: "/keyword-magic-tool" }];

export default async function KeywordMagicToolPage({ searchParams }: PageProps<"/keyword-magic-tool">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const match: MatchType = MATCH_TYPES.some((m) => m.id === sp.match) ? (sp.match as MatchType) : "broad";
  const questions = sp.questions === "1";
  const seed = normalizeKw(raw);
  const invalid = !seed ? null : seed.length > 80 ? "Seed keywords can be at most 80 characters." : /[,\n;]/.test(raw) ? "Enter one seed keyword. To analyze several keywords at once, use Keyword Overview in bulk mode." : !/[\p{L}\p{N}]/u.test(seed) ? "Enter a keyword with at least one letter or number." : null;

  if (!seed || invalid)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Keyword Magic Tool" description="Turn one seed keyword into hundreds of ideas: grouped by topic, filterable by volume, difficulty and intent, enriched with real Google Autocomplete suggestions.">
          <ToolSearch placeholder="Enter a seed keyword, e.g. running shoes" defaultValue={raw} />
        </PageHeader>
        {invalid && (
          <Callout tone="warning" className="mb-4" action={/[,\n;]/.test(raw) ? <ButtonLink size="sm" href={`/keyword-overview?q=${encodeURIComponent(raw)}&db=${db}`}>Open bulk analysis</ButtonLink> : undefined}>
            {invalid}
          </Callout>
        )}
        <Card>
          <EmptyState
            icon={<Wand2 className="h-5 w-5" />}
            title="Find keyword ideas for any seed"
            description="Match types (broad, phrase, exact, related), question keywords, word groups and filters work like the tool you know. Try an example:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((e) => (
                  <ButtonLink key={e} href={`/keyword-magic-tool?q=${encodeURIComponent(e)}&db=${db}`} size="sm">
                    {e}
                  </ButtonLink>
                ))}
              </div>
            }
          />
        </Card>
      </Page>
    );

  const pool = await ideaPool(user.id, seed, db);
  const sel = selectIdeas(pool, match, questions);
  const counts = Object.fromEntries((["broad", "phrase", "exact"] as const).map((m) => [m, selectIdeas(pool, m, questions, 0).total]));
  if (match === "related") counts.related = sel.total;
  const questionCount = selectIdeas(pool, match, true, 0).total;
  const allCount = questions ? selectIdeas(pool, match, false, 0).total : sel.total;
  const info = database(db);
  const href = (m: MatchType, q: boolean) => `/keyword-magic-tool?q=${encodeURIComponent(seed)}&db=${db}${m !== "broad" ? `&match=${m}` : ""}${q ? "&questions=1" : ""}`;
  const ac = pool.autocomplete;

  return (
    <Page wide>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Keyword Magic Tool:"
        subject={seed}
        meta={
          <>
            <SourceBadges source={pool.source} fetchedAt={pool.fetchedAt} autocomplete={ac} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            {pool.topicName && <Badge tone="brand">{pool.topicName}</Badge>}
          </>
        }
        actions={
          <ButtonLink href={`/keyword-overview?q=${encodeURIComponent(seed)}&db=${db}`} variant="secondary">
            Keyword Overview
          </ButtonLink>
        }
      >
        <ToolSearch placeholder="Enter a seed keyword" keep={["match"]} />
      </PageHeader>

      <p className="-mt-2 mb-4 text-[12.5px] text-text-3">
        Sources: {pool.source === "demo" ? "demo keyword database (metrics are synthetic)" : "DataForSEO Labs keyword database"}
        {ac.status === "ok" && (
          <>
            {" "}+ <span className="font-medium text-good-ink">Google Autocomplete</span> ({ac.count.toLocaleString()} real suggestions for “{seed}”, fetched {ac.fetchedAt ? timeAgo(ac.fetchedAt) : "now"}; their metrics come from the same database)
          </>
        )}
        {ac.status === "failed" && <> · Google Autocomplete was unreachable, so only database ideas are shown.</>}
        {ac.status === "disabled" && <> · Google Autocomplete is disabled (ENABLE_AUTOCOMPLETE=false).</>}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkSegmented
          items={[
            { href: href(match, false), label: "All keywords", active: !questions, count: allCount.toLocaleString() },
            { href: href(match, true), label: "Questions", active: questions, count: questionCount.toLocaleString() },
          ]}
        />
        <LinkSegmented
          items={MATCH_TYPES.map((m) => ({ href: href(m.id, questions), label: m.label, active: match === m.id, count: counts[m.id]?.toLocaleString(), title: m.note }))}
        />
      </div>

      {sel.total === 0 ? (
        <Card>
          <EmptyState
            title={questions ? "No question keywords for this match type" : "No keywords found"}
            description={match === "exact" ? "Exact match needs the seed phrase word for word. Try Phrase or Broad match." : "Try a broader match type or a shorter seed keyword."}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href={href("broad", false)} size="sm">
                  Broad match, all keywords
                </ButtonLink>
                <ButtonLink href={href("related", false)} size="sm">
                  Related keywords
                </ButtonLink>
              </div>
            }
          />
        </Card>
      ) : (
        <MagicTool seed={seed} db={db} match={match} rows={sel.rows} total={sel.total} truncated={sel.truncated} hasAutocomplete={ac.status === "ok" && sel.rows.some((r) => r.ac)} />
      )}
      <p className="mt-4 text-[12px] text-text-3">
        Tip: select keywords and use <span className="font-medium text-text-2">Add to list</span> to cluster them in the{" "}
        <Link href="/keyword-strategy" className="text-link hover:underline">
          Keyword Strategy Builder
        </Link>
        , or plan ads in the{" "}
        <Link href="/ppc-keyword-tool" className="text-link hover:underline">
          PPC Keyword Tool
        </Link>
        .
      </p>
      {pool.source === "demo" && <DemoNotice className="mt-2" />}
    </Page>
  );
}
