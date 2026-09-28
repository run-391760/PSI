import { Radar } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { NewProjectButton } from "@/components/projects/project-form";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

/** Empty state for CX listening pages when the user has no brand (project) yet. */
export function NoBrand({ title }: { title: string }) {
  return (
    <Page>
      <PageHeader title={title} breadcrumbs={[{ label: "CX" }, { label: "Listening" }]} />
      <Card>
        <EmptyState
          icon={<Radar className="h-5 w-5" />}
          title="Create a brand to start listening"
          description="A brand is one of your projects. Add topics for it (brand, competitors, campaigns) and mentions are collected from news, forums, social networks and app stores."
          action={<NewProjectButton redirectTo="/cx/listening/topics?brand={id}" label="Create brand" />}
        />
      </Card>
    </Page>
  );
}
