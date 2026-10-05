"use client";

import { ChevronsLeft, ChevronsRight, LayoutGrid, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyNavPrefs, PINNED_GROUP_ID } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { cxSavedDashboardsAction } from "./cx-nav-actions";
import { CX_NAV, cxTabFor, keepParams, pickActive, type CxNavItem, type CxTab } from "./cx-nav";
import { CustomizeMenuDialog } from "./customize-menu";
import { useUiPrefs } from "./ui-prefs";

type Group = { id: string; label: string; items: CxNavItem[] };

// Sidebar, drawer and menu all use useCxSidebar(); share one request per brand + page.
const inflight = new Map<string, Promise<{ id: string; name: string }[]>>();
function savedDashboards(brand: string | null, pathname: string) {
  const key = `${brand ?? ""}|${pathname}`;
  let p = inflight.get(key);
  if (!p) {
    p = cxSavedDashboardsAction(brand);
    inflight.set(key, p);
    p.finally(() => setTimeout(() => inflight.delete(key), 1500));
  }
  return p;
}

/** The current tab's sidebar groups as the user customised them (pinned first), plus the active href. */
export function useCxSidebar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const { prefs } = useUiPrefs();
  const tab: CxTab = cxTabFor(pathname);
  const brand = params.get("brand");
  const [dashboards, setDashboards] = useState<{ brand: string | null; items: { id: string; name: string }[] } | null>(null);

  useEffect(() => {
    // Refetched on every navigation inside the DASHBOARD tab so new/renamed dashboards show up.
    if (tab !== "dashboard") return;
    let live = true;
    savedDashboards(brand, pathname).then((items) => live && setDashboards({ brand, items }));
    return () => {
      live = false;
    };
  }, [tab, brand, pathname]);

  const groups = useMemo<Group[]>(() => {
    const ids = new Set(CX_NAV.filter((g) => g.tab === tab).map((g) => g.id));
    const out = applyNavPrefs(CX_NAV, prefs.nav).filter((g) => g.id === PINNED_GROUP_ID || ids.has(g.id)) as Group[];
    if (tab === "dashboard" && dashboards?.brand === brand && dashboards.items.length)
      out.push({ id: "dashboard-saved", label: "Saved dashboards", items: dashboards.items.map((d) => ({ href: `/cx/dashboards/${d.id}`, label: d.name, icon: LayoutGrid, description: "Saved dashboard" })) });
    return out;
  }, [tab, prefs.nav, dashboards, brand]);

  const active = pickActive(pathname, params, groups.flatMap((g) => g.items));
  const href = (h: string) => keepParams(h, params);
  return { tab, groups, active, href };
}

/** Konnect-style white sidebar: uppercase group labels, icon + label rows, light-blue active row. */
export function CxSidebarNav({ onNavigate, rail }: { onNavigate?: () => void; rail?: boolean }) {
  const { groups, active, href } = useCxSidebar();
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const showTip = (el: HTMLElement, label: string) => {
    // Tooltips only while the sidebar is an icon rail.
    if (!rail || !ref.current || ref.current.offsetWidth > 100) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  return (
    <nav ref={ref} className="nav-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2" onMouseLeave={() => setTip(null)}>
      {groups.map((g, gi) => (
        <div key={g.id} className="mb-2">
          {g.label && <div className="cx-rail-hide px-5 pt-3 pb-1.5 text-[11.5px] font-semibold tracking-[0.08em] text-text uppercase">{g.label}</div>}
          {rail && gi > 0 && <div className="cx-rail-only mx-3 my-2 border-t border-border" />}
          <ul>
            {g.items.map((item) => {
              const on = item.href === active;
              const Icon = item.icon;
              return (
                <li key={`${g.id}:${item.href}`}>
                  <Link
                    href={href(item.href)}
                    onClick={onNavigate}
                    aria-label={item.label}
                    aria-current={on ? "page" : undefined}
                    onMouseEnter={(e) => showTip(e.currentTarget, item.label)}
                    onFocus={(e) => showTip(e.currentTarget, item.label)}
                    onBlur={() => setTip(null)}
                    className={cn(
                      "cx-rail-center flex h-9 items-center gap-3 px-5 text-[14px] transition-colors",
                      on ? "bg-[var(--cx-active-bg)] font-medium text-[var(--cx-active-ink)]" : "text-text-2 hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <Icon className={cn("h-[18px] w-[18px] shrink-0", on ? "text-[var(--cx-active-ink)]" : "text-text-3")} strokeWidth={1.75} />
                    <span className="cx-rail-hide truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {tip && (
        <div role="tooltip" className="pointer-events-none fixed z-[60] -translate-y-1/2 rounded-md bg-[#1d2233] px-2.5 py-1.5 text-[12px] whitespace-nowrap text-white shadow-pop" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      )}
    </nav>
  );
}

/** Desktop sidebar (≥1024px). Phones use the hamburger drawer, which shows the same groups. */
export function CxSidebar() {
  const { prefs, update } = useUiPrefs();
  const [customizing, setCustomizing] = useState(false);
  const footerBtn = "cx-rail-center flex h-8 w-full items-center gap-3 px-5 text-[12.5px] text-text-3 hover:bg-surface-2 hover:text-text";
  return (
    <>
      <aside
        className="cx-sidebar no-print sticky top-12 z-20 hidden h-[calc(100vh-3rem)] shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex"
        aria-label="CX navigation"
      >
        <CxSidebarNav rail />
        <div className="shrink-0 border-t border-border py-1.5">
          <button type="button" onClick={() => setCustomizing(true)} className={footerBtn} title="Customize menu" aria-label="Customize menu">
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="cx-rail-hide">Customize menu</span>
          </button>
          {!prefs.focus && (
            <button type="button" onClick={() => update({ collapsed: !prefs.collapsed })} className={footerBtn} aria-label={prefs.collapsed ? "Expand sidebar" : "Collapse sidebar"} title={prefs.collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {prefs.collapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
              <span className="cx-rail-hide">Collapse</span>
            </button>
          )}
        </div>
      </aside>
      <CustomizeMenuDialog open={customizing} onClose={() => setCustomizing(false)} />
    </>
  );
}
