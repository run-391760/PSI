import { ClipboardCheck, FileText, Search, Wand2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/shell/page";
import { timeAgo } from "@/lib/format";
import type { OptimizerData } from "@/app/(app)/optimizer/data";
import { DraftActions, DraftSwitcher, NewDraftButton, StatusLine } from "./header";

/** Header shared by every optimizer tab: title, open draft (switcher), score + status, actions. */
export function OptimizerHeader({ data, title, description, basePath }: { data: OptimizerData; title: string; description: string; basePath: string }) {
  const { draft, report, drafts } = data;
  return (
    <>
      <PageHeader
        title={title}
        subject={draft?.keyword ? `“${draft.keyword}”` : undefined}
        description={description}
        breadcrumbs={[{ label: "Pre-Publish Optimizer", href: draft ? `/optimizer?doc=${draft.id}` : "/optimizer" }, ...(title !== "Dashboard" ? [{ label: title }] : [])]}
        meta={
          draft && report ? (
            <>
              <DraftSwitcher drafts={drafts} currentId={draft.id} basePath={basePath} />
              <StatusLine status={report.status} score={report.overall} />
              <span className="text-[12px] text-text-3">
                {draft.status === "published" ? `Published ${draft.publishedAt ? timeAgo(draft.publishedAt) : ""}` : `Draft · updated ${timeAgo(draft.updatedAt)}`}
                {data.bundle?.research ? ` · research ${timeAgo(data.bundle.research.fetchedAt)}` : " · no SERP research yet"}
              </span>
            </>
          ) : undefined
        }
        actions={
          draft && report ? (
            <>
              <NewDraftButton variant="secondary" />
              <DraftActions draftId={draft.id} status={report.status} published={draft.status === "published"} aiOn={data.aiOn} serpOn={data.serpOn} hasCompetitors={!!draft.meta.competitors?.length} blockers={report.blockers.length} />
            </>
          ) : undefined
        }
      />
      {data.missing && <Callout tone="warning" className="mb-4" title="That draft was not found">Showing your most recent draft instead.</Callout>}
      {data.aiStale && <Callout tone="info" className="mb-4" title="The Claude review is out of date">The draft changed substantially since Claude reviewed it, so its scores are no longer used. Run “Claude review” again.</Callout>}
    </>
  );
}

export function OptimizerEmpty() {
  return (
    <Card>
      <EmptyState
        icon={<ClipboardCheck className="h-5 w-5" />}
        title="Know exactly what to fix before you publish"
        description="Paste a blog draft or import a page. The optimizer runs 58 pre-publish checks across search intent, content quality, topical coverage, on-page SEO, E-E-A-T, SERP & AI readiness, linking/UX and technical SEO, scores it out of 10, flags publication blockers and applies fixes in one click."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <NewDraftButton label="Write or paste a draft" />
            <ButtonLink href="/optimizer/content-planning" variant="secondary">
              <FileText className="h-4 w-4" /> Start from a content brief
            </ButtonLink>
          </div>
        }
      />
      <div className="grid gap-3 border-t border-border p-4 text-[13px] text-text-2 sm:grid-cols-3">
        <div className="flex gap-2">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" /> Audit against the live SERP (DataForSEO), the competitor pages you add and Google Autocomplete.
        </div>
        <div className="flex gap-2">
          <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" /> Every issue explains what to fix, why it matters and how — with one-click fixes and re-scoring.
        </div>
        <div className="flex gap-2">
          <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" /> Critical blockers keep a draft from “Ready to publish” even when the score is high.
        </div>
      </div>
    </Card>
  );
}
