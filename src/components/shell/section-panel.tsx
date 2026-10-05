"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { keepParams, pickActive, type SectionGroup } from "./cx-nav";

export type { SectionGroup, SectionItem, SectionPanelData } from "./cx-nav";

/**
 * Konnect-style secondary navigation panel (SETTINGS, REPORTS, TOPICS…). While one is on the page the
 * main CX sidebar collapses to an icon rail (CSS `:has([data-section-panel])`, so there is no flash).
 * On phones it becomes a collapsible block above the content. Hidden in focus mode.
 *
 *   // src/app/(app)/cx/settings/layout.tsx
 *   import { CX_SETTINGS_PANEL } from "@/components/shell/cx-nav";
 *   import { SectionLayout, SectionPanel } from "@/components/shell/section-panel";
 *   export default function Layout({ children }: { children: React.ReactNode }) {
 *     return <SectionLayout panel={<SectionPanel {...CX_SETTINGS_PANEL} />}>{children}</SectionLayout>;
 *   }
 *
 * - `groups`: [{ label?, items: [{ href, label, match?, isDefault?, badge? }], collapsed? }]. The active
 *   item is chosen like the sidebar's (longest path prefix; href query params must match).
 * - `icons`: header icon buttons (React elements, e.g. duplicate / customise / download).
 * - `keep`: query params carried over from the current URL into every link (default ["brand"]).
 * - `children`: extra content under the groups (e.g. an empty state or a "new topic" link).
 */
export function SectionPanel({
  title,
  icons,
  groups,
  keep = ["brand"],
  children,
  className,
}: {
  title: string;
  icons?: ReactNode;
  groups: SectionGroup[];
  keep?: string[];
  children?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = pickActive(pathname, params, items);
  const activeLabel = items.find((i) => i.href === active)?.label;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  useEffect(() => setMobileOpen(false), [pathname, search]);

  return (
    <aside
      data-section-panel=""
      data-focus-hide=""
      aria-label={`${title} navigation`}
      className={cn(
        "no-print shrink-0 border-b border-border bg-surface lg:sticky lg:top-12 lg:h-[calc(100vh-3rem)] lg:w-[208px] lg:overflow-y-auto lg:border-r lg:border-b-0",
        "scroll-thin",
        className,
      )}
    >
      <div className="flex h-11 items-center gap-1 px-4 lg:h-12">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left lg:pointer-events-none"
          aria-expanded={mobileOpen}
        >
          <span className="text-[11.5px] font-semibold tracking-[0.08em] text-text uppercase">{title}</span>
          {activeLabel && <span className="truncate text-[12.5px] text-text-3 lg:hidden">· {activeLabel}</span>}
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-text-3 transition-transform lg:hidden", mobileOpen && "rotate-180")} />
        </button>
        {icons && <div className="flex shrink-0 items-center gap-0.5 text-text-2 [&_a]:rounded [&_a]:p-1 [&_a:hover]:bg-surface-3 [&_button]:rounded [&_button]:p-1 [&_button:hover]:bg-surface-3">{icons}</div>}
      </div>
      <nav className={cn("pb-3", mobileOpen ? "block" : "hidden lg:block")}>
        {groups.map((g, gi) => {
          const holdsActive = g.items.some((i) => i.href === active);
          const open = toggled[gi] ?? (!g.collapsed || holdsActive);
          const collapsible = !!g.label && !!g.collapsed;
          return (
            <div key={g.label ?? gi} className={cn(gi > 0 && g.label && "mt-1")}>
              {g.label &&
                (collapsible ? (
                  <button
                    type="button"
                    onClick={() => setToggled((t) => ({ ...t, [gi]: !open }))}
                    aria-expanded={open}
                    className={cn("flex w-full items-center gap-2 px-4 py-2 text-left text-[11px] font-semibold tracking-[0.08em] text-text uppercase hover:bg-surface-2", holdsActive && "bg-[var(--cx-group-bg)]")}
                  >
                    <span className="flex-1">{g.label}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-text-3 transition-transform", !open && "-rotate-90")} />
                  </button>
                ) : (
                  <div className={cn("px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-text uppercase", holdsActive && "bg-[var(--cx-group-bg)]")}>{g.label}</div>
                ))}
              {open && (
                <ul>
                  {g.items.map((i) => {
                    const on = i.href === active;
                    return (
                      <li key={i.href}>
                        <Link
                          href={keepParams(i.href, params, keep)}
                          aria-current={on ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2 border-l-[3px] py-1.5 pr-3 pl-[17px] text-[13px] leading-snug transition-colors",
                            on ? "border-[var(--cx-active-ink)] bg-[var(--cx-active-bg)] font-medium text-[var(--cx-active-ink)]" : "border-transparent text-text-2 hover:bg-surface-2 hover:text-text",
                          )}
                        >
                          <span className="min-w-0 flex-1">{i.label}</span>
                          {i.badge && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">{i.badge}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {children && <div className="px-4 pt-2">{children}</div>}
      </nav>
    </aside>
  );
}

/** Two-column layout for section layouts: the panel on the left (top on phones), content on the right. */
export function SectionLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col lg:flex-row lg:items-start">
      {panel}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
