"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { DrillSpec } from "@/lib/cx/reports/model";
import { DrillDrawer } from "./drawer";

/**
 * Page-level report state: the brand, shared series toggles (a legend click on "Negative" hides Negative in
 * every chart, tile and pie of the page that shares the key) and the drill-down drawer.
 *
 *   <ReportProvider brand={brand.id} ai={aiConfigured()}> …widgets… </ReportProvider>
 */
type Ctx = {
  brand: string;
  ai: boolean;
  hidden: Set<string>;
  toggle: (key: string) => void;
  openDrill: (spec: DrillSpec) => void;
};
const ReportContext = createContext<Ctx | null>(null);

export function ReportProvider({ brand, ai = false, children }: { brand: string; ai?: boolean; children: ReactNode }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [spec, setSpec] = useState<DrillSpec | null>(null);
  const toggle = useCallback((key: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  }), []);
  const value = useMemo(() => ({ brand, ai, hidden, toggle, openDrill: setSpec }), [brand, ai, hidden, toggle]);
  return (
    <ReportContext.Provider value={value}>
      {children}
      <DrillDrawer brand={brand} spec={spec} onClose={() => setSpec(null)} />
    </ReportContext.Provider>
  );
}

/** Report context; outside a provider, toggles are local no-ops and drills are ignored. */
export function useReport(): Ctx {
  return useContext(ReportContext) ?? FALLBACK;
}
const FALLBACK: Ctx = { brand: "", ai: false, hidden: new Set(), toggle: () => {}, openDrill: () => {} };

/** Series visibility: shared through the provider, or local to one chart when `shared` is false. */
export function useSeriesToggle(shared = true) {
  const r = useReport();
  const [local, setLocal] = useState<Set<string>>(new Set());
  const toggleLocal = useCallback((key: string) => setLocal((h) => {
    const n = new Set(h);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  }), []);
  return shared ? { hidden: r.hidden, toggle: r.toggle } : { hidden: local, toggle: toggleLocal };
}
