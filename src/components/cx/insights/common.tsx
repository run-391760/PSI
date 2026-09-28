import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { NewProjectButton } from "@/components/projects/project-form";
import { BrandSwitcher } from "@/components/cx/brand-switcher";

/** Link inside CX that keeps the active brand. */
export const cxHref = (path: string, brand: string, extra: Record<string, string | number | undefined> = {}) => {
  const p = new URLSearchParams({ brand });
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") p.set(k, String(v));
  return `${path}${path.includes("?") ? "&" : "?"}${p.toString()}`;
};

/** Ticket deep link into the inbox module. */
export const ticketHref = (brand: string, ticketId: string) => cxHref("/cx/inbox", brand, { ticket: ticketId });

export function NoBrand({ title, breadcrumbs }: { title: string; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <Page>
      <PageHeader title={title} breadcrumbs={breadcrumbs ?? [{ label: "CX" }, { label: title }]} />
      <Card>
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title="Create a brand to start"
          description="A CX brand is one of your projects. Create one to connect channels, invite your team and collect feedback."
          action={<NewProjectButton redirectTo="/cx?brand={id}" label="Create brand" />}
        />
      </Card>
    </Page>
  );
}

export function BrandMeta({ switcher, current, children }: { switcher: { id: string; name: string; domain: string }[]; current: string; children?: ReactNode }) {
  return (
    <>
      <BrandSwitcher brands={switcher} current={current} />
      {children}
    </>
  );
}

export const SENTIMENT_TONE: Record<string, "good" | "critical" | "neutral"> = { positive: "good", negative: "critical", neutral: "neutral" };
