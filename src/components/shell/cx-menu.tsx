"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CX_TABS, cxTabFor } from "./cx-nav";
import { CxSidebarNav } from "./cx-sidebar";
import { CustomizeMenuDialog } from "./customize-menu";
import { Logo } from "./logo";

/**
 * Phones and tablets (below 1024px): the CX sidebar is desktop-only, so the header's navigation button
 * opens it here as a slide-in drawer. Desktop has no menu button; every module is in the sidebar,
 * Customize menu or search.
 */
export function CxMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const tab = cxTabFor(pathname);
  const [customizing, setCustomizing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const tabLabel = CX_TABS.find((t) => t.id === tab)?.label ?? "Monitor";

  useEffect(() => onClose(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={cn("no-print fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        inert={!open}
        className={cn(
          "cx-drawer no-print fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col bg-surface text-text shadow-modal transition-transform duration-200 lg:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-[var(--cx-header)] px-4 text-white">
          <Logo size={24} />
          <span className="text-[14px] font-semibold tracking-wide uppercase">
            Nerve <span className="text-[#a99dff]">Signal</span>
          </span>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1.5 text-[var(--cx-header-muted)] hover:bg-white/10 hover:text-white" aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="nav-scroll min-h-0 flex-1 overflow-y-auto pb-3">
          <div className="px-5 pt-3 text-[10.5px] font-semibold tracking-[0.1em] text-text-3 uppercase">{tabLabel}</div>
          <CxSidebarNav onNavigate={onClose} />
          <div className="border-t border-border py-2">
            <button type="button" onClick={() => setCustomizing(true)} className="flex h-9 w-full items-center gap-3 px-5 text-[14px] text-text-2 hover:bg-surface-2 hover:text-text">
              <SlidersHorizontal className="h-[18px] w-[18px] shrink-0 text-text-3" strokeWidth={1.75} /> Customize menu
            </button>
          </div>
        </div>
      </div>
      <CustomizeMenuDialog open={customizing} onClose={() => setCustomizing(false)} />
    </>
  );
}
