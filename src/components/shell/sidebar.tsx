"use client";

import { ChevronsLeft, ChevronsRight, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { activeHref } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";
import { Logo } from "./logo";
import { useUiPrefs } from "./ui-prefs";

/** SEO workspace sidebar (the CX workspace uses CxSidebar / CxMenu). */
export function Sidebar({ mobileOpen, onClose, available }: { mobileOpen: boolean; onClose: () => void; available?: Partial<Record<string, boolean>> }) {
  const pathname = usePathname();
  const { prefs, update } = useUiPrefs();
  useEffect(() => onClose(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // Focus mode reduces the sidebar to an icon rail; the user's own collapse choice is kept underneath.
  const collapsed = prefs.collapsed || prefs.focus;
  const groups = NAV;
  const settingsHref = "/settings";
  const best = activeHref(pathname, [...groups.flatMap((g) => g.items.map((i) => i.href)), settingsHref]);
  const isActive = (href: string) => href === best || (href === "/settings" && pathname.startsWith("/settings"));
  const footerItem = "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] hover:bg-white/5 hover:text-white";

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-50 flex flex-col bg-nav text-nav-text transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          collapsed ? "lg:w-[60px]" : "lg:w-[236px]",
          "w-[260px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-14 shrink-0 items-center border-b border-white/5 px-4", collapsed && "lg:justify-center lg:px-0")}>
          <Link href="/dashboard" className="flex items-center gap-2">
            <Logo />
            <span className={cn("text-[15px] font-semibold tracking-tight text-white", collapsed && "lg:hidden")}>
              Synapse<span className="text-[#a99dff]">SEO</span>
            </span>
          </Link>
          <button className="ml-auto rounded p-1 text-nav-muted hover:text-white lg:hidden" onClick={onClose} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="nav-scroll flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group.id} className="mb-3">
              {group.label && (
                <div className={cn("px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-wider text-nav-muted uppercase", collapsed && "lg:hidden")}>{group.label}</div>
              )}
              {collapsed && group.label && <div className="mx-3 mb-1.5 hidden border-t border-white/5 lg:block" />}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                          active ? "bg-nav-active font-medium text-white" : "text-nav-text hover:bg-white/5 hover:text-white",
                          collapsed && "lg:justify-center lg:px-0",
                        )}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[#b3a8ff]" : "text-nav-muted group-hover:text-nav-text")} />
                        <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
                        {item.requires && available && !item.requires.some((p) => available[p]) && (
                          <span title="Needs an API connection for data" className={cn("ml-auto rounded border border-white/10 px-1 text-[9.5px] font-semibold tracking-wide text-nav-muted", collapsed && "lg:hidden")}>
                            API
                          </span>
                        )}
                        {item.badge && <span className={cn("ml-auto rounded bg-[#8b7cff]/25 px-1.5 text-[10px] font-semibold text-[#c9c1ff]", collapsed && "lg:hidden")}>{item.badge}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-white/5 p-2">
          <Link
            href={settingsHref}
            title={collapsed ? "Settings" : undefined}
            className={cn(footerItem, isActive(settingsHref) && "bg-nav-active text-white", collapsed && "lg:justify-center lg:px-0")}
            aria-current={isActive(settingsHref) ? "page" : undefined}
          >
            <Settings className="h-4 w-4 shrink-0 text-nav-muted" />
            <span className={cn(collapsed && "lg:hidden")}>Settings</span>
          </Link>
          {!prefs.focus && (
            <button type="button" onClick={() => update({ collapsed: !prefs.collapsed })} className={cn(footerItem, "hidden text-[12.5px] text-nav-muted lg:flex", collapsed && "lg:justify-center lg:px-0")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              <span className={cn(collapsed && "lg:hidden")}>Collapse</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
