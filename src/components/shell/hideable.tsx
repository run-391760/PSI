"use client";

import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useTransition } from "react";
import { hiddenPanels, panelState, restorePanels, setPanel, type PanelState } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { useUiPrefs } from "./ui-prefs";

/**
 * Wrap any panel/widget so each user can collapse or hide it (stored server-side per user).
 * `id` is "<scope>.<name>" (e.g. "cx-overview.trends"); put <ShowHidden scope="cx-overview" /> on the
 * page to restore hidden panels. Server pages can skip expensive data for non-open panels with
 * `panelState(prefs.panels, id, defaultState)` and pass `refreshOnExpand` so expanding re-renders.
 */
export function Hideable({
  id,
  label,
  children,
  defaultState = "open",
  refreshOnExpand,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  defaultState?: PanelState;
  refreshOnExpand?: boolean;
  className?: string;
}) {
  const { prefs, update } = useUiPrefs();
  const router = useRouter();
  const [pending, start] = useTransition();
  const state = panelState(prefs.panels, id, defaultState);
  const set = (next: PanelState) => {
    const saved = update({ panels: setPanel(prefs.panels, id, next, label, defaultState) });
    if (next === "open" && refreshOnExpand) start(async () => (await saved, router.refresh()));
  };
  if (state === "hidden") return null;

  const hideBtn = (
    <button type="button" onClick={() => set("hidden")} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" title={`Hide ${label}`} aria-label={`Hide ${label}`}>
      <EyeOff className="h-3.5 w-3.5" />
    </button>
  );

  if (state === "collapsed")
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface px-3 py-1.5", className)} data-hideable={id}>
        <button type="button" onClick={() => set("open")} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-medium text-text-2 hover:text-text" aria-expanded={false}>
          <ChevronDown className="h-4 w-4 shrink-0 text-text-3" />
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-[12px] font-normal text-text-3">{pending ? "Loading…" : "Collapsed · show"}</span>
        </button>
        {hideBtn}
      </div>
    );

  return (
    <div className={cn("group/hide relative", className)} data-hideable={id}>
      <div className="no-print absolute -top-2.5 right-3 z-10 flex items-center rounded-full border border-border bg-surface px-0.5 shadow-card transition-opacity focus-within:opacity-100 group-hover/hide:opacity-100 sm:opacity-0 [@media(hover:none)]:opacity-100">
        <button type="button" onClick={() => set("collapsed")} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" title={`Collapse ${label}`} aria-label={`Collapse ${label}`} aria-expanded>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        {hideBtn}
      </div>
      {children == null || children === false ? <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-text-3">{pending ? "Loading…" : label}</div> : children}
    </div>
  );
}

/** "Show hidden (n)" restore control for the hidden panels of a page scope. Renders nothing when none. */
export function ShowHidden({ scope, refresh, className }: { scope: string; refresh?: boolean; className?: string }) {
  const { prefs, update } = useUiPrefs();
  const router = useRouter();
  const hidden = hiddenPanels(prefs.panels, scope);
  if (!hidden.length) return null;
  const after = (p: Promise<void>) => refresh && p.then(() => router.refresh());
  return (
    <Menu
      align="right"
      className={className}
      trigger={(open) => (
        <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[12.5px] font-medium text-text shadow-card hover:bg-surface-3" aria-expanded={open}>
          <Eye className="h-3.5 w-3.5 text-text-3" /> Show hidden ({hidden.length})
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Hidden on this page</div>
          {hidden.map((h) => (
            <MenuItem key={h.id} icon={<Eye className="h-4 w-4 text-text-3" />} onClick={() => (close(), after(update({ panels: setPanel(prefs.panels, h.id, "open", h.label) })))}>
              {h.label}
            </MenuItem>
          ))}
          {hidden.length > 1 && (
            <div className="mt-1 border-t border-border pt-1">
              <MenuItem onClick={() => (close(), after(update({ panels: restorePanels(prefs.panels, scope) })))}>Show all</MenuItem>
            </div>
          )}
        </>
      )}
    </Menu>
  );
}
