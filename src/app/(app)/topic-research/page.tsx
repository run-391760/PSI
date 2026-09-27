import { Lightbulb } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { compact } from "@/lib/format";
import { normalizeKw } from "@/lib/keywords/text";
import { getTopicResearch, listFavorites } from "@/lib/keywords/topics";
import { kdBand } from "@/components/seo/badges";
import { DemoNotice } from "@/components/seo/source-badge";
import { NeedsData } from "@/components/seo/needs-data";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { TabsNav } from "@/components/ui/tabs";
import { AddToListButton } from "@/components/keywords/add-to-list";
import { MindMap } from "@/components/keywords/mind-map";
import { SourceBadges } from "@/components/keywords/source-badges";
import { FavoritesTable, IdeaListCard, TopicCards, TopicExplorer } from "@/components/keywords/topic-research";

export const metadata: Metadata = { title: "Topic Research" };

const EXAMPLES = ["running shoes", "intermittent fasting", "home loan", "digital marketing", "study abroad"];
const BREADCRUMBS = [{ label: "Content marketing" }, { label: "Topic Research", href: "/topic-research" }];
const VIEWS = ["cards", "explorer", "mindmap", "overview", "favorites"] as const;

export default async function TopicResearchPage({ searchParams }: PageProps<"/topic-research">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const view = VIEWS.includes(sp.view as (typeof VIEWS)[number]) ? (sp.view as (typeof VIEWS)[number]) : "cards";
  const topic = normalizeKw(raw);
  const invalid = !topic ? null : topic.length > 80 ? "Topics can be at most 80 characters." : !/[\p{L}\p{N}]/u.test(topic) ? "Enter a topic with at least one letter or number." : null;
  const allFavorites = await listFavorites(user.id);

  if (!topic || invalid)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Topic Research" description="Find content ideas for any topic: subtopics ranked by volume, difficulty and efficiency, with headlines from the top-ranking pages, the questions people ask and related searches.">
          <ToolSearch placeholder="Enter a topic, e.g. running shoes" defaultValue={raw} buttonLabel="Get content ideas" />
        </PageHeader>
        {invalid && <Callout tone="warning" className="mb-4">{invalid}</Callout>}
        <Grid cols={2} className="lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <EmptyState
              icon={<Lightbulb className="h-5 w-5" />}
              title="What should you write about next?"
              description="Enter a broad topic to see its subtopics and proven angles. Try one of these:"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((e) => (
                    <ButtonLink key={e} href={`/topic-research?q=${encodeURIComponent(e)}&db=${db}`} size="sm">
                      {e}
                    </ButtonLink>
                  ))}
                </div>
              }
            />
          </Card>
          <Card>
            <CardHeader title="Favorite ideas" description={`${allFavorites.length} saved`} />
            <FavoritesTable favorites={allFavorites.slice(0, 50)} />
          </Card>
        </Grid>
      </Page>
    );

  const t = await getTopicResearch(user.id, topic, db);
  const info = database(db);
  const favorites = allFavorites.filter((f) => f.topic === topic && f.db === db);
  const favKeys = favorites.map((f) => `${f.kind}|${f.text}`);
  const base = `/topic-research?q=${encodeURIComponent(topic)}&db=${db}`;
  const headlines = t.subtopics.reduce((s, x) => s + x.headlines.length, 0);
  const questions = t.subtopics.reduce((s, x) => s + x.questions.length, 0);
  const metrics = t.source !== "autocomplete";

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Topic Research:"
        subject={topic}
        meta={
          <>
            <SourceBadges source={t.source} fetchedAt={t.fetchedAt} autocomplete={t.autocomplete} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            {t.topicName && <Badge tone="brand">{t.topicName}</Badge>}
          </>
        }
        actions={
          <>
            <AddToListButton keywords={t.subtopics.map((s) => s.keyword)} db={db} defaultName={`${topic} topics`} from="topic-research" label="Add subtopics to list" />
            <ButtonLink href={`/keyword-magic-tool?q=${encodeURIComponent(topic)}&db=${db}`}>Keyword Magic Tool</ButtonLink>
          </>
        }
      >
        <ToolSearch placeholder="Enter a topic" buttonLabel="Get content ideas" keep={["view"]} />
      </PageHeader>

      {!metrics && (
        <NeedsData
          compact
          className="mb-4"
          providers={["dataforseo"]}
          title="Volumes, difficulty and top-ranking headlines need DataForSEO"
          shows={["Search volume and difficulty per subtopic", "Topic efficiency (volume vs. difficulty)", "Headlines of the pages ranking in the live Google top 10", "Thousands of database ideas beyond Autocomplete"]}
        >
          <p className="mt-2 text-[12.5px] text-text-2">Shown now: subtopics, questions and related searches from real Google Autocomplete suggestions, grouped by shared words.</p>
        </NeedsData>
      )}
      {t.subtopics.length === 0 ? (
        <Card>
          <EmptyState
            title={!metrics && t.autocomplete.status !== "ok" ? "Google Autocomplete returned no suggestions" : "Not enough data for this topic"}
            description={!metrics && t.autocomplete.status !== "ok" ? "Autocomplete could not be reached; it will be retried shortly." : "Try a broader topic (one or two words), or check the spelling."}
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Topic volume" value={compact(t.volume)} sub={t.volume == null ? "needs DataForSEO" : `${info.flag} monthly searches, all ideas`} />
              <Metric label="Avg. difficulty" value={t.difficulty == null ? "n/a" : `${t.difficulty}%`} sub={t.difficulty == null ? (metrics ? undefined : "needs DataForSEO") : kdBand(t.difficulty).label} />
              <Metric label="Subtopics" value={t.subtopics.length} sub={metrics ? undefined : "grouped by shared words"} />
              <Metric label="Headlines" value={t.serpHeadlines ? headlines : "n/a"} sub={t.serpHeadlines ? "from the top 10 + ideas" : "needs DataForSEO"} />
              <Metric label="Questions" value={questions} sub={t.autocomplete.status === "ok" ? "incl. real autocomplete" : undefined} />
            </MetricStrip>
          </Card>

          <TabsNav
            param="view"
            className="mb-4"
            items={[
              { href: `${base}&view=cards`, label: "Cards" },
              { href: `${base}&view=explorer`, label: "Explorer" },
              { href: `${base}&view=mindmap`, label: "Mind map" },
              { href: `${base}&view=overview`, label: "Overview" },
              { href: `${base}&view=favorites`, label: "Favorite ideas", count: favorites.length },
            ]}
          />

          {view === "cards" && <TopicCards subtopics={t.subtopics} topic={topic} db={db} favorites={favKeys} metrics={metrics} />}
          {view === "explorer" && <TopicExplorer subtopics={t.subtopics} topic={topic} db={db} favorites={favKeys} />}
          {view === "mindmap" && (
            <Card>
              <CardHeader title="Topic mind map" description="Largest subtopics with their most searched questions and related searches" />
              <CardBody>
                <MindMap
                  root={topic}
                  rootSub={t.volume == null ? `${t.subtopics.length} subtopics` : `${compact(t.volume)} volume · ${t.subtopics.length} subtopics`}
                  branches={[...t.subtopics]
                    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || b.keywords - a.keywords)
                    .slice(0, 12)
                    .map((s) => ({
                      label: s.name,
                      sub: s.volume == null ? `${s.keywords} suggestions` : `${compact(s.volume)} vol · KD ${s.difficulty ?? "n/a"}% · ${s.efficiencyLabel} efficiency`,
                      href: `/keyword-overview?q=${encodeURIComponent(s.keyword)}&db=${db}`,
                      children: [...s.questions.slice(0, 2), ...s.related.slice(0, 2)].map((i) => ({ label: i.text, sub: i.volume != null ? compact(i.volume) : undefined })),
                    }))}
                  maxLeaves={4}
                />
              </CardBody>
            </Card>
          )}
          {view === "overview" && (
            <Grid cols={3}>
              {t.serpHeadlines ? (
                <Card>
                  <CardHeader title="Top headlines" description={t.source === "demo" ? "Titles of top-10 pages, by backlinks" : "Titles of pages in the live Google top 10"} />
                  <CardBody>
                    <IdeaListCard ideas={t.topHeadlines} topic={topic} db={db} favorites={favKeys} empty="No headlines found." />
                  </CardBody>
                </Card>
              ) : (
                <NeedsData compact providers={["dataforseo"]} title="Top headlines need DataForSEO" shows={["Titles of the pages ranking in the live Google top 10 for each subtopic"]} />
              )}
              <Card>
                <CardHeader title="Interesting questions" description={metrics ? "Most searched questions" : "Real Google Autocomplete questions"} />
                <CardBody>
                  <IdeaListCard ideas={t.topQuestions} topic={topic} db={db} favorites={favKeys} empty="No questions found." />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Related searches" description={t.autocomplete.status === "ok" ? "Real Google Autocomplete suggestions" : "Related keywords"} />
                <CardBody>
                  <IdeaListCard ideas={t.relatedSearches} topic={topic} db={db} favorites={favKeys} empty="No related searches found." />
                </CardBody>
              </Card>
            </Grid>
          )}
          {view === "favorites" && (
            <Card>
              <CardHeader title="Favorite ideas" description={`${favorites.length} saved for “${topic}” · ${allFavorites.length} across all topics`} />
              <FavoritesTable favorites={allFavorites} />
            </Card>
          )}
        </>
      )}
      {t.source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}
