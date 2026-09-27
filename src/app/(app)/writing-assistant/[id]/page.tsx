import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { findDocument, type DocSettings } from "@/lib/content/documents";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { WritingEditor } from "@/components/content/writing/editor";
import { Page } from "@/components/shell/page";

export const metadata: Metadata = { title: "SEO Writing Assistant" };

const DEFAULTS: DocSettings = { targetWords: 1000, targetReadability: 60, tone: "neutral", recommended: [], db: "US" };

export default async function WritingAssistantDocPage({ params }: PageProps<"/writing-assistant/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  const doc = await findDocument(user.id, id);
  if (!doc) notFound();
  let settings: DocSettings = { ...DEFAULTS, ...(doc.settings as Partial<DocSettings>) };
  // Older documents may carry targets derived from the demo engine: drop them unless DEMO_DATA=true.
  if (settings.demoTargets && !demoAllowed()) settings = { ...settings, targetWords: DEFAULTS.targetWords, targetReadability: DEFAULTS.targetReadability, recommended: [], demoTargets: false, targetsSource: "manual" };
  return (
    <Page wide>
      <WritingEditor
        key={doc.id}
        recommendSource={liveEnabled() ? "serp" : "autocomplete"}
        doc={{
          id: doc.id,
          title: doc.title,
          body: doc.body,
          keywords: doc.keywords,
          settings,
          updated_at: new Date(doc.updated_at).toISOString(),
        }}
      />
    </Page>
  );
}
