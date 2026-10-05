"use client";

import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Before → after banner shown after a fix is applied and the draft re-scored (One-Click Apply &
 * Re-score). Any component calls flashScore(); the banner is mounted once per optimizer page.
 */

export type Flash = { title: string; before?: number | null; after?: number | null; status?: string; error?: boolean; detail?: string };

export function flashScore(f: Flash) {
  window.dispatchEvent(new CustomEvent<Flash>("opt:flash", { detail: f }));
}

export function ScoreFlash() {
  const [f, setF] = useState<Flash | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setF((e as CustomEvent<Flash>).detail);
      clearTimeout(t);
      t = setTimeout(() => setF(null), (e as CustomEvent<Flash>).detail.error ? 9000 : 6500);
    };
    window.addEventListener("opt:flash", on);
    return () => {
      window.removeEventListener("opt:flash", on);
      clearTimeout(t);
    };
  }, []);
  if (!f) return null;
  const delta = f.before != null && f.after != null ? Math.round((f.after - f.before) * 10) / 10 : null;
  return (
    <div role="status" aria-live="polite" className={cn("no-print fixed right-4 bottom-4 left-4 z-[70] ml-auto max-w-sm rounded-lg border bg-surface p-3 shadow-pop sm:left-auto", f.error ? "border-critical/40" : "border-border")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={cn("text-[13px] font-semibold", f.error ? "text-critical-ink" : "text-text")}>{f.title}</div>
          {f.after !== undefined && (
            <div className="mt-1 flex items-center gap-2 text-[13px] text-text-2">
              <span className="tabular-nums">{f.before?.toFixed(1) ?? "n/a"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
              <span className="font-semibold text-text tabular-nums">{f.after?.toFixed(1) ?? "n/a"}/10</span>
              {delta != null && delta !== 0 && <span className={cn("rounded px-1 text-[11.5px] font-semibold", delta > 0 ? "bg-good-soft text-good-ink" : "bg-critical-soft text-critical-ink")}>{delta > 0 ? `+${delta}` : delta}</span>}
              {f.status && <span className="text-text-3">· {f.status}</span>}
            </div>
          )}
          {f.detail && <div className="mt-1 text-[12.5px] whitespace-pre-line text-text-2">{f.detail}</div>}
        </div>
        <button type="button" onClick={() => setF(null)} className="rounded p-0.5 text-text-3 hover:text-text" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
