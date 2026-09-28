"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { savePrefsAction } from "@/app/(app)/cx/inbox/actions";
import { DEFAULT_PREFS, type InboxPrefs } from "@/lib/cx/inbox/model";

/** Per-user workspace preferences (layout, alignment, absolute dates, sounds, Enter-to-send…), saved server-side. */
type Ctx = { prefs: InboxPrefs; setPrefs: (p: Partial<InboxPrefs>) => void };
export const PrefsContext = createContext<Ctx>({ prefs: DEFAULT_PREFS, setPrefs: () => {} });
export const usePrefs = () => useContext(PrefsContext);

export function PrefsProvider({ brand, initial, children }: { brand: string; initial: InboxPrefs; children: ReactNode }) {
  const [prefs, set] = useState(initial);
  const setPrefs = useCallback((p: Partial<InboxPrefs>) => {
    set((x) => ({ ...x, ...p }));
    savePrefsAction(brand, p).catch(() => {});
  }, [brand]);
  useEffect(() => unlockAudio(), []);
  return <PrefsContext.Provider value={{ prefs, setPrefs }}>{children}</PrefsContext.Provider>;
}

// ---------------------------------------------------------------- sound alerts (Web Audio, no asset files)

let ctx: AudioContext | null = null;
function unlockAudio() {
  const on = () => {
    try {
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") void ctx.resume();
    } catch {}
  };
  window.addEventListener("pointerdown", on, { once: true });
  window.addEventListener("keydown", on, { once: true });
  return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); };
}
/** Two-tone chime for a new ticket, a single soft tone for a new message in the open conversation. */
export function playAlert(kind: "ticket" | "message") {
  try {
    if (!ctx || ctx.state !== "running") return;
    const tones = kind === "ticket" ? [[880, 0], [1320, 0.16]] : [[660, 0]];
    for (const [f, delay] of tones) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const t = ctx.currentTime + delay;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    }
  } catch {}
}
/** Calls `onNew` when `ids` gains members compared with the previous render (not on first render). */
export function useNewItems(ids: string[], onNew: (added: string[]) => void) {
  const prev = useRef<Set<string> | null>(null);
  const key = ids.join(",");
  useEffect(() => {
    const cur = new Set(key ? key.split(",") : []);
    if (prev.current) {
      const added = [...cur].filter((x) => !prev.current!.has(x));
      if (added.length) onNew(added);
    }
    prev.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
