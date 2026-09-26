import { BookOpenCheck, FileText, PenLine, Repeat2, SpellCheck2, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { listDocuments } from "@/lib/content/documents";
import { DocList, NewDocumentButton } from "@/components/content/writing/doc-list";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";

export const metadata: Metadata = { title: "SEO Writing Assistant" };

const FEATURES = [
  { icon: <Target className="h-4 w-4" />, title: "SEO", text: "Target and recommended keyword usage, title and H1, links, image alt text and length vs the top 10." },
  { icon: <BookOpenCheck className="h-4 w-4" />, title: "Readability", text: "Flesch reading ease and grade, long sentences and paragraphs, passive voice and complex words." },
  { icon: <SpellCheck2 className="h-4 w-4" />, title: "Tone of voice", text: "Where your text sits between casual and formal, with the sentences that break consistency." },
  { icon: <Repeat2 className="h-4 w-4" />, title: "Originality", text: "Repeated sentences and phrases inside your document (not a web plagiarism check)." },
];

export default async function WritingAssistantPage() {
  const user = await requirePageUser();
  const docs = await listDocuments(user.id);
  const scored = docs.filter((d) => d.words > 0);
  const avgScore = scored.length ? scored.reduce((s, d) => s + d.score, 0) / scored.length : null;
  const words = docs.reduce((s, d) => s + d.words, 0);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Content marketing" }, { label: "SEO Writing Assistant", href: "/writing-assistant" }]}
        title="SEO Writing Assistant"
        description="Write and optimize content with live SEO, readability, tone-of-voice and originality scoring."
        meta={<DataSourceBadge source="user" note="your documents" />}
        actions={
          <>
            <ButtonLink href="/seo-content-template">
              <FileText className="h-4 w-4" /> From a content template
            </ButtonLink>
            <NewDocumentButton />
          </>
        }
      />
      {docs.length === 0 ? (
        <>
          <Card className="mb-4">
            <EmptyState
              icon={<PenLine className="h-5 w-5" />}
              title="Create your first document"
              description="Start from scratch, import an existing page by URL, or build a brief in the SEO Content Template and open it here with targets prefilled."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <NewDocumentButton />
                  <ButtonLink href="/seo-content-template">Use a content template</ButtonLink>
                </div>
              }
            />
          </Card>
          <Grid cols={4}>
            {FEATURES.map((f) => (
              <Card key={f.title}>
                <CardBody className="pt-4">
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-brand-soft text-brand-ink">{f.icon}</div>
                  <div className="text-[13.5px] font-semibold">{f.title}</div>
                  <p className="mt-1 text-[13px] text-text-2">{f.text}</p>
                </CardBody>
              </Card>
            ))}
          </Grid>
        </>
      ) : (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Documents" value={docs.length} />
              <Metric label="Average score" value={avgScore == null ? "n/a" : avgScore.toFixed(1)} sub="Of documents with text, 0–10" />
              <Metric label="Words written" value={words.toLocaleString("en-US")} />
              <Metric label="Ready to publish" value={scored.filter((d) => d.score >= 8).length} sub="Score 8 or higher" />
            </MetricStrip>
          </Card>
          <Card>
            <CardHeader title="Documents" description="Saved automatically as you type" />
            <DocList rows={docs.map((d) => ({ ...d, updated_at: new Date(d.updated_at).toISOString(), created_at: new Date(d.created_at).toISOString() }))} />
          </Card>
          <p className="mt-4 text-[12px] text-text-3">
            Scores are computed from your text in the browser. Target lengths and recommended keywords come from the top-10 benchmark (demo data) — see the{" "}
            <Link href="/seo-content-template" className="text-link hover:underline">
              SEO Content Template
            </Link>
            .
          </p>
        </>
      )}
    </Page>
  );
}
