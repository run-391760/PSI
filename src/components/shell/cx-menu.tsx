"use client";

import { LogOut, Settings, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CX_MENU, CX_TABS, cxTabFor, keepParams, pickActive } from "./cx-nav";
import { CxSidebarNav } from "./cx-sidebar";
import { CustomizeMenuDialog } from "./customize-menu";
import { Logo } from "./logo";

/**
 * Hamburger slide-in panel (spec §1): Konnect's own modules, our extra CX modules (Listening,
 * Customers), the CX overview, settings and logout. On phones it also carries the current tab's
 * sidebar, since the sidebar itself is desktop-only.
 */
export function CxMenu({ open, onClose, logoutAction }: { open: boolean; onClose: () => void; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const tab = cxTabFor(pathname);
  const [customizing, setCustomizing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const tabLabel = CX_TABS.find((t) => t.id === tab)?.label ?? "Monitor";
  const active = pickActive(pathname, params, CX_MENU.flatMap((s) => s.items));

  useEffect(() => onClose(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const row = "flex h-9 items-center gap-3 px-5 text-[14px] transition-colors";
  return (
    <>
      <div className={cn("no-print fixed inset-0 z-40 bg-black/40 transition-opacity", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="CX menu"
        inert={!open}
        className={cn(
          "no-print fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col bg-surface text-text shadow-modal transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 bg-[var(--cx-header)] px-4 text-white">
          <Logo size={24} />
          <span className="text-[14px] font-semibold tracking-wide uppercase">
            Synapse<span className="opacity-80">CX</span>
          </span>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1.5 text-[var(--cx-header-muted)] hover:bg-white/10 hover:text-white" aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="nav-scroll min-h-0 flex-1 overflow-y-auto pb-3">
          <div className="border-b border-border pb-2 lg:hidden">
            <div className="px-5 pt-3 text-[10.5px] font-semibold tracking-[0.1em] text-text-3 uppercase">{tabLabel}</div>
            <CxSidebarNav onNavigate={onClose} />
          </div>
          {CX_MENU.map((s) => (
            <section key={s.id} className="border-b border-border py-2 last:border-0">
              {s.label && <div className="px-5 pt-1 pb-1.5 text-[11.5px] font-semibold tracking-[0.08em] text-text uppercase">{s.label}</div>}
              <ul>
                {s.items.map((i) => {
                  const on = i.href === active;
                  return (
                    <li key={i.href}>
                      <Link
                        href={keepParams(i.href, params)}
                        onClick={onClose}
                        aria-current={on ? "page" : undefined}
                        className={cn(row, on ? "bg-[var(--cx-active-bg)] font-medium text-[var(--cx-active-ink)]" : "text-text-2 hover:bg-surface-2 hover:text-text")}
                      >
                        <i.icon className={cn("h-[18px] w-[18px] shrink-0", on ? "text-[var(--cx-active-ink)]" : "text-text-3")} strokeWidth={1.75} />
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <section className="border-t border-border py-2">
            <Link href={keepParams("/cx/settings", params)} onClick={onClose} className={cn(row, "text-text-2 hover:bg-surface-2 hover:text-text")}>
              <Settings className="h-[18px] w-[18px] shrink-0 text-text-3" strokeWidth={1.75} /> Settings
            </Link>
            <button type="button" onClick={() => setCustomizing(true)} className={cn(row, "w-full text-text-2 hover:bg-surface-2 hover:text-text")}>
              <SlidersHorizontal className="h-[18px] w-[18px] shrink-0 text-text-3" strokeWidth={1.75} /> Customize menu
            </button>
            <form action={logoutAction}>
              <button type="submit" className={cn(row, "w-full text-text-2 hover:bg-surface-2 hover:text-text")}>
                <LogOut className="h-[18px] w-[18px] shrink-0 text-text-3" strokeWidth={1.75} /> Logout
              </button>
            </form>
          </section>
        </div>
      </div>
      <CustomizeMenuDialog open={customizing} onClose={() => setCustomizing(false)} />
    </>
  );
}
