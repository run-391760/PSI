"use client";

import { Maximize2, Minimize2, Pause, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Wall-display shell: theme (CSS variable overrides scoped to the wall), true full-screen, auto-refresh.
 * Theme choice is a per-viewer convenience kept in localStorage.
 */
const THEMES: Record<string, { label: string; vars: Record<string, string> }> = {
  midnight: {
    label: "Midnight",
    vars: { "--bg": "#0a0d14", "--surface": "#121620", "--surface-2": "#161b27", "--surface-3": "#1d2331", "--border": "#252c3b", "--border-strong": "#353d51", "--text": "#f2f4f7", "--text-2": "#b3bbca", "--text-3": "#818a9c", "--chart-grid": "#1f2533", "--chart-axis": "#353d51", "--chart-text": "#818a9c", "--good-ink": "#5fd35f", "--critical-ink": "#ff8585", "--warning-ink": "#ffc94d", "--serious-ink": "#ffa47f", "--brand-soft": "#231d4d", "--brand-ink": "#c4bbff", "--good-soft": "#12301a", "--critical-soft": "#3a1618", "--warning-soft": "#352a0c", "--serious-soft": "#3a2117" },
  },
  daylight: { label: "Daylight", vars: {} },
  contrast: {
    label: "High contrast",
    vars: { "--bg": "#000000", "--surface": "#000000", "--surface-2": "#0b0b0b", "--surface-3": "#1a1a1a", "--border": "#5c5c5c", "--border-strong": "#8a8a8a", "--text": "#ffffff", "--text-2": "#e6e6e6", "--text-3": "#c2c2c2", "--chart-grid": "#333333", "--chart-axis": "#8a8a8a", "--chart-text": "#c2c2c2", "--good-ink": "#7dff7d", "--critical-ink": "#ff9c9c", "--warning-ink": "#ffe066", "--serious-ink": "#ffb38f", "--brand-soft": "#2b2b2b", "--brand-ink": "#ffffff", "--good-soft": "#0f2d0f", "--critical-soft": "#3d0f0f", "--warning-soft": "#3d330a", "--serious-soft": "#3d200f" },
  },
  ocean: {
    label: "Ocean",
    vars: { "--bg": "#06182b", "--surface": "#0b2440", "--surface-2": "#0f2b4b", "--surface-3": "#143559", "--border": "#1d4169", "--border-strong": "#2a5585", "--text": "#eef5ff", "--text-2": "#b5c9e3", "--text-3": "#86a0c0", "--chart-grid": "#163a61", "--chart-axis": "#2a5585", "--chart-text": "#86a0c0", "--good-ink": "#6fe3a0", "--critical-ink": "#ff8f8f", "--warning-ink": "#ffd166", "--serious-ink": "#ffab80", "--brand-soft": "#1a2f63", "--brand-ink": "#c9d6ff", "--good-soft": "#0e3326", "--critical-soft": "#3b1620", "--warning-soft": "#3a2f10", "--serious-soft": "#3a2418" },
  },
};

export function CommandWall({ title, updatedAt, refreshSec = 60, children, toolbar }: { title: string; updatedAt: string; refreshSec?: number; children: ReactNode; toolbar?: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState("midnight");
  const [full, setFull] = useState(false);
  const [paused, setPaused] = useState(false);
  const [clock, setClock] = useState<string | null>(null);
  const [left, setLeft] = useState(refreshSec);

  useEffect(() => {
    try {
      const t = localStorage.getItem("cx-wall-theme");
      if (t && THEMES[t]) setTheme(t);
    } catch {}
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setLeft(refreshSec);
  }, [updatedAt, refreshSec]);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          router.refresh();
          return refreshSec;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [paused, refreshSec, router]);

  const pick = (t: string) => {
    setTheme(t);
    try {
      localStorage.setItem("cx-wall-theme", t);
    } catch {}
  };
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ref.current?.requestFullscreen();
    } catch {}
  };
  const style = { ...THEMES[theme].vars, background: "var(--bg)", color: "var(--text)" } as CSSProperties;
  return (
    <div ref={ref} style={style} data-wall-theme={theme} className={cn("rounded-xl border border-border p-3 sm:p-4", full && "h-screen overflow-y-auto rounded-none border-0 p-6")}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[18px] font-semibold text-text">{title}</h2>
        {toolbar}
        <span className="text-[13px] text-text-2 tabular-nums" suppressHydrationWarning>{clock}</span>
        <select aria-label="Wall theme" value={theme} onChange={(e) => pick(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[12.5px] text-text">
          {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <button type="button" onClick={() => setPaused((p) => !p)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[12.5px] text-text" aria-label={paused ? "Resume auto-refresh" : "Pause auto-refresh"}>
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          <span className="tabular-nums">{paused ? "Paused" : `${left}s`}</span>
        </button>
        <button type="button" onClick={() => router.refresh()} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-surface text-text" aria-label="Refresh now">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={toggleFull} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[12.5px] text-text">
          {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} {full ? "Exit" : "Full screen"}
        </button>
      </div>
      {children}
    </div>
  );
}

/** A wall tile. */
export function Tile({ title, children, className, action }: { title: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-surface p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold tracking-wide text-text-2 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
