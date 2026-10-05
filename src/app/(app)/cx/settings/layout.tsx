import { Suspense, type ReactNode } from "react";
import { CX_SETTINGS_PANEL } from "@/components/shell/cx-nav";
import { SectionLayout, SectionPanel } from "@/components/shell/section-panel";

/** Settings section: SETTINGS secondary panel (the main sidebar collapses to the rail) + the settings page. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SectionLayout
      panel={
        <Suspense fallback={<div className="lg:w-[208px]" />}>
          <SectionPanel {...CX_SETTINGS_PANEL} />
        </Suspense>
      }
    >
      {children}
    </SectionLayout>
  );
}
