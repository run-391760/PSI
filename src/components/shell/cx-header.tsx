"use client";

import { Menu as MenuIcon, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { MenuItem } from "@/components/ui/dialog";
import { CX_TABS, cxTabFor, keepParams } from "./cx-nav";
import { Logo } from "./logo";
import { AccountMenu, AlertsBell, DisplayMenu, FocusToggle, GlobalSearch, iconBtn, WorkspaceSwitch } from "./topbar";

/**
 * CX workspace header (Konnect layout): dark brand-blue bar with the hamburger, logo + product name,
 * the SEO | CX switch, top tabs MONITOR | SOCIAL ANALYTICS | PUBLISH | DASHBOARD (active tab from the
 * route, see cxTabFor), global search, focus/display controls, alerts bell and avatar menu.
 * Below 1024px the tabs move to a second, horizontally scrolling row; below 768px search is an icon.
 */
export function CxHeader({ user, unread, onMenu, logoutAction }: { user: { name: string; email: string }; unread: number; onMenu: () => void; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const tab = cxTabFor(pathname);
  const [searching, setSearching] = useState(false);

  const tabs = (cls: string) => (
    <nav aria-label="CX sections" className={cn("cx-tabs overflow-x-auto", cls)}>
      {CX_TABS.map((t) => {
        const on = t.id === tab;
        return (
          <Link
            key={t.id}
            href={keepParams(t.href, params)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-full shrink-0 items-center border-b-[3px] px-3 pt-[3px] text-[12px] font-semibold tracking-[0.1em] whitespace-nowrap uppercase transition-colors",
              on ? "border-white bg-white/[0.06] text-white" : "border-transparent text-[var(--cx-header-muted)] hover:text-white",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <header className="no-print sticky top-0 z-30 bg-[var(--cx-header)] text-white shadow-[0_1px_0_rgba(0,0,0,0.15)]">
      <div className="flex h-12 items-center gap-1.5 px-2 sm:gap-2 sm:px-3">
        <button type="button" onClick={onMenu} className={iconBtn("brand")} aria-label="Open menu" title="Menu">
          <MenuIcon className="h-5 w-5" />
        </button>
        <Link href={keepParams("/cx", params)} className="flex shrink-0 items-center gap-2" aria-label="SynapseCX home">
          <Logo size={24} />
          <span className="hidden text-[13.5px] font-semibold tracking-wide uppercase sm:inline">
            Synapse<span className="opacity-80">CX</span>
          </span>
        </Link>
        <div className="ml-1 shrink-0">
          <WorkspaceSwitch variant="brand" />
        </div>
        {tabs("ml-3 hidden h-12 items-stretch lg:flex")}
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          <GlobalSearch variant="brand" className="hidden w-56 md:block xl:w-72" />
          <button type="button" onClick={() => setSearching((s) => !s)} className={cn(iconBtn("brand"), "md:hidden")} aria-label={searching ? "Close search" : "Search"} aria-expanded={searching}>
            {searching ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
          <FocusToggle variant="brand" />
          <DisplayMenu variant="brand" />
          <AlertsBell unread={unread} variant="brand" />
          <AccountMenu
            user={user}
            logoutAction={logoutAction}
            variant="brand"
            extra={
              <MenuItem href={keepParams("/cx/settings", params)} icon={<Settings className="h-4 w-4 text-text-3" />}>
                CX settings
              </MenuItem>
            }
          />
        </div>
      </div>
      {searching && (
        <div className="px-3 pb-2 md:hidden">
          <GlobalSearch variant="brand" />
        </div>
      )}
      {tabs("flex h-10 items-stretch border-t border-white/10 px-1 lg:hidden")}
    </header>
  );
}
