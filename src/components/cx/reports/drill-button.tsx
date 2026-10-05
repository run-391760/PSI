"use client";

import type { ReactNode } from "react";
import type { DrillSpec } from "@/lib/cx/reports/model";
import { useReport } from "./kit";

/** Any element that opens the report drawer on click (e.g. one survey response in a list). */
export function DrillButton({ spec, className, title = "Click to see the details", children }: { spec: DrillSpec; className?: string; title?: string; children: ReactNode }) {
  const { openDrill } = useReport();
  return (
    <button type="button" onClick={() => openDrill(spec)} className={className} title={title}>
      {children}
    </button>
  );
}
