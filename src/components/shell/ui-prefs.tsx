"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { saveUiPrefsAction } from "@/lib/cx/ui/actions";
import { DEFAULT_PREFS, type UiPrefs } from "@/lib/cx/ui/prefs-logic";

type Ctx = {
  prefs: UiPrefs;
  /** Optimistic update; persisted server-side in call order. Resolves when saved. */
  update: (patch: Partial<UiPrefs>) => Promise<void>;
  /** True when rendered inside the app shell (preferences can be saved). */
  ready: boolean;
};

const UiPrefsContext = createContext<Ctx>({ prefs: DEFAULT_PREFS, update: async () => {}, ready: false });

export function UiPrefsProvider({ initial, children }: { initial: UiPrefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const update = useCallback((patch: Partial<UiPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    const run = chain.current.then(() => saveUiPrefsAction(patch)).then((r) => {
      if (!r.ok) console.warn(r.error);
    });
    chain.current = run.catch(() => {});
    return run.catch(() => {});
  }, []);
  const value = useMemo(() => ({ prefs, update, ready: true }), [prefs, update]);
  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export const useUiPrefs = () => useContext(UiPrefsContext);
