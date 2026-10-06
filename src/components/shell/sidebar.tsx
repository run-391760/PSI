"use client";

import { ChevronDown, ChevronsLeft, ChevronsRight, Settings, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { activeHref, applyNavPrefs, panelState, setPanel } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { CustomizeMenuDialog } from "./customize-menu";
import { NAV, NAV_SECTIONS, navSectionPanel, type NavItem, type NavSection } from "./nav";
import { Logo } from "./logo";
import { useUiPrefs } from "./ui-prefs";

type Group = { id: string; label: string; items: NavItem[] };
/** What the sidebar renders: unlabelled blocks (Pinned, the top group) and the collapsible sections with their sub-groups. */
type Block = { id: string; label: string; section?: NavSection; groups: Group[] };

const DESKTOP = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  const mq = matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
/** ≥1024px the sidebar is a static column; below it is a modal drawer. The server renders the desktop case. */
const useDesktop = () => useSyncExternalStore(subscribeDesktop, () => matchMedia(DESKTOP).matches, () => true);

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * SEO workspace sidebar (the CX workspace uses CxSidebar / CxMenu), with the CX shell's typography:
 * white uppercase section labels, sentence-case sub-group labels, full-bleed 14px rows with 18px icons.
 * Items follow the user's menu customisation (pins, hides, order; `defaultHidden` tools stay out until
 * shown). Sections collapse (saved as UI prefs panels `seo-nav.<id>`); a collapsed section still shows
 * the current page's row. Desktop: 220px, or a 52px icon rail when collapsed or in focus mode. Phones:
 * a modal drawer (Esc closes, focus moves in and is kept inside, inert while closed).
 */
export function Sidebar({ mobileOpen, onClose, available }: { mobileOpen: boolean; onClose: () => void; available?: Partial<Record<string, boolean>> }) {
  const pathname = usePathname();
  const { prefs, update } = useUiPrefs();
  const desktop = useDesktop();
  const drawer = !desktop;
  const [customizing, setCustomizing] = useState(false);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => onClose(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the current page's row in view (e.g. a Monitor tool below the fold). Scrolls the menu only, never the page.
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !el) return;
    const n = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < n.top || r.bottom > n.bottom) nav.scrollTop += r.top - n.top - (n.height - r.height) / 2;
  }, [pathname]);
  // Focus mode reduces the sidebar to an icon rail; the user's own collapse choice is kept underneath.
  const rail = prefs.collapsed || prefs.focus;

  const blocks = useMemo<Block[]>(() => {
    const groups = applyNavPrefs(NAV, prefs.nav);
    const section = (id: string) => NAV.find((g) => g.id === id)?.section;
    const out: Block[] = groups.filter((g) => !section(g.id)).map((g) => ({ id: g.id, label: g.label, groups: [{ ...g, label: "" }] }));
    for (const s of NAV_SECTIONS) {
      const gs = groups.filter((g) => section(g.id) === s.id);
      if (gs.length) out.push({ id: s.id, label: s.label, section: s, groups: gs });
    }
    return out;
  }, [prefs.nav]);

  const settingsHref = "/settings";
  const best = activeHref(pathname, [...blocks.flatMap((b) => b.groups.flatMap((g) => g.items.map((i) => i.href))), settingsHref]);
  const isActive = (href: string) => href === best || (href === settingsHref && pathname.startsWith(settingsHref));

  const sectionCollapsed = (s: NavSection) => panelState(prefs.panels, navSectionPanel(s.id), s.collapsed ? "collapsed" : "open") === "collapsed";
  const toggleSection = (s: NavSection) =>
    update({ panels: setPanel(prefs.panels, navSectionPanel(s.id), sectionCollapsed(s) ? "open" : "collapsed", `${s.label} menu section`, s.collapsed ? "collapsed" : "open") });

  // Drawer: focus the close button on open, keep Tab inside, Esc closes, focus returns to the opener.
  useEffect(() => {
    if (!drawer || !mobileOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return; // the Customize dialog handles its own keys
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && asideRef.current) {
        const els = [...asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!els.length) return;
        const [first, last] = [els[0], els[els.length - 1]];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [drawer, mobileOpen, onClose]);

  // Custom tooltips, only while the sidebar is an icon rail (native titles are slow and unstyled).
  const tipProps = (label: string) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => showTip(e.currentTarget, label),
    onFocus: (e: FocusEvent<HTMLElement>) => showTip(e.currentTarget, label),
    onBlur: () => setTip(null),
  });
  const showTip = (el: HTMLElement, label: string) => {
    if (!rail || !asideRef.current || asideRef.current.offsetWidth > 100) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };

  const railHide = rail && "lg:hidden";
  const railCenter = rail && "lg:justify-center lg:px-0";
  const footerItem = cn("flex h-8 w-full items-center gap-3 px-5 text-[12.5px] text-nav-muted transition-colors hover:bg-white/5 hover:text-white", railCenter);

  const row = (g: Group, item: NavItem, railOnly?: boolean) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    const needsApi = !!item.requires && !!available && !item.requires.some((p) => available[p]);
    // One marker per row: the "New" pill wins over the quiet "API" hint (needs a connection for data).
    const pill: ReactNode = item.badge ? (
      <span className="ml-auto shrink-0 rounded bg-nav-badge px-1.5 text-[10.5px] font-semibold text-nav-badge-ink">{item.badge}</span>
    ) : needsApi ? (
      <span title="Needs an API connection for data" className="ml-auto shrink-0 text-[10px] font-semibold tracking-wide text-nav-muted">
        API<span className="sr-only">: needs an API connection</span>
      </span>
    ) : null;
    // The icon rail hides the text, so it needs a name; otherwise the visible text (incl. the marker) is the name.
    const railName = `${item.label}${item.badge ? `, ${item.badge}` : needsApi ? ", needs an API connection" : ""}`;
    return (
      <li key={`${g.id}:${item.href}`} className={railOnly ? "hidden lg:block" : undefined}>
        <Link
          href={item.href}
          aria-label={rail && desktop ? railName : undefined}
          aria-current={active ? "page" : undefined}
          {...tipProps(item.label)}
          className={cn(
            "group flex h-9 items-center gap-3 px-5 text-[14px] transition-colors",
            active ? "bg-nav-active font-medium text-white" : "text-nav-text hover:bg-white/5 hover:text-white",
            railCenter,
          )}
        >
          <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-nav-active-icon" : "text-nav-muted group-hover:text-nav-text")} strokeWidth={1.75} />
          <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", railHide)}>
            <span className="truncate">{item.short ?? item.label}</span>
            {pill}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        ref={asideRef}
        role={drawer ? "dialog" : undefined}
        aria-modal={drawer && mobileOpen ? true : undefined}
        inert={drawer && !mobileOpen}
        className={cn(
          "no-print fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[85vw] flex-col bg-nav text-nav-text transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:max-w-none lg:translate-x-0",
          rail ? "lg:w-[52px]" : "lg:w-[220px]",
          mobileOpen ? "translate-x-0 shadow-modal lg:shadow-none" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-12 shrink-0 items-center gap-2 border-b border-white/5 px-5", railCenter)}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2" aria-label="SynapseSEO home">
            <Logo size={24} />
            <span className={cn("text-[13.5px] font-semibold tracking-wide text-white uppercase", railHide)}>
              Synapse<span className="text-nav-accent">SEO</span>
            </span>
          </Link>
          <button ref={closeRef} type="button" className="-mr-2 ml-auto rounded p-1.5 text-nav-muted hover:text-white lg:hidden" onClick={onClose} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav ref={navRef} className="nav-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2" aria-label="SEO tools" onMouseLeave={() => setTip(null)} onScroll={() => setTip(null)}>
          {blocks.map((b, bi) => {
            const s = b.section;
            const closed = !!s && sectionCollapsed(s);
            const bodyId = `seo-nav-${b.id}`;
            return (
              <div key={b.id} className="mb-2">
                {s ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(s)}
                    aria-expanded={!closed}
                    aria-controls={bodyId}
                    className={cn("group/sec flex w-full items-center gap-2 px-5 pt-3 pb-1.5 text-left text-[11.5px] font-semibold tracking-[0.08em] text-white uppercase", railHide)}
                  >
                    <span className="flex-1 truncate">{b.label}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-nav-muted transition-transform group-hover/sec:text-nav-text", closed && "-rotate-90")} aria-hidden />
                  </button>
                ) : (
                  b.label && <div className={cn("px-5 pt-3 pb-1.5 text-[11.5px] font-semibold tracking-[0.08em] text-white uppercase", railHide)}>{b.label}</div>
                )}
                {rail && bi > 0 && <div className="mx-3 my-2 hidden border-t border-white/5 lg:block" />}
                <div id={bodyId}>
                  {b.groups.map((g) => {
                    // A collapsed section keeps the current page's row; the icon rail always shows every item.
                    const rows = g.items.filter((i) => !closed || rail || isActive(i.href));
                    if (!rows.length) return null;
                    return (
                      <div key={g.id}>
                        {g.label && !closed && <div className={cn("px-5 pt-2 pb-1 text-[11px] font-medium text-nav-muted", railHide)}>{g.label}</div>}
                        <ul>{rows.map((item) => row(g, item, closed && !isActive(item.href)))}</ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-white/5 py-1.5" onMouseLeave={() => setTip(null)}>
          <button type="button" onClick={() => setCustomizing(true)} className={footerItem} aria-label="Customize menu" {...tipProps("Customize menu")}>
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className={cn(railHide)}>Customize menu</span>
          </button>
          <Link
            href={settingsHref}
            aria-label="Settings"
            className={cn(footerItem, isActive(settingsHref) && "bg-nav-active text-white")}
            aria-current={isActive(settingsHref) ? "page" : undefined}
            {...tipProps("Settings")}
          >
            <Settings className={cn("h-4 w-4 shrink-0", isActive(settingsHref) && "text-nav-active-icon")} />
            <span className={cn(railHide)}>Settings</span>
          </Link>
          {!prefs.focus && (
            <button
              type="button"
              onClick={() => (setTip(null), update({ collapsed: !prefs.collapsed }))}
              className={cn(footerItem, "hidden lg:flex")}
              aria-label={prefs.collapsed ? "Expand sidebar" : "Collapse sidebar"}
              {...tipProps(prefs.collapsed ? "Expand sidebar" : "Collapse sidebar")}
            >
              {prefs.collapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
              <span className={cn(railHide)}>Collapse</span>
            </button>
          )}
        </div>
      </aside>
      {/* Outside the <aside>: its transform would make `fixed` relative to the sidebar. */}
      {tip && (
        <div role="tooltip" className="pointer-events-none fixed z-[60] -translate-y-1/2 rounded-md bg-nav-tooltip px-2.5 py-1.5 text-[12px] whitespace-nowrap text-white shadow-pop" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      )}
      <CustomizeMenuDialog open={customizing} onClose={() => setCustomizing(false)} workspace="seo" />
    </>
  );
}
