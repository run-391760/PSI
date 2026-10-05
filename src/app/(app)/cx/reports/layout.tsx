import { Suspense, type ReactNode } from "react";
import { CX_REPORTS_PANEL } from "@/components/shell/cx-nav";
import { SectionLayout, SectionPanel } from "@/components/shell/section-panel";
import { ReportsPanelIcons } from "@/components/cx/reports/panel-icons";

/** Reports section: REPORTS secondary panel (main sidebar collapses to the rail) + the report page. */
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <SectionLayout
      panel={
        <Suspense fallback={<div className="lg:w-[208px]" />}>
          <SectionPanel {...CX_REPORTS_PANEL} icons={<ReportsPanelIcons />} keep={["brand", "from", "to", "media", "scope", "basis"]} />
        </Suspense>
      }
    >
      {children}
    </SectionLayout>
  );
}
