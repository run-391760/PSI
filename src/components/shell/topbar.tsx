"use client";

import { Bell, Check, Focus, LogOut, Menu as MenuIcon, Moon, RotateCcw, Search, Settings, SlidersHorizontal, Sun, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { classifyQuery } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/tabs";
import { restorePanels } from "@/lib/cx/ui/prefs-logic";
import { OptimizerTabs } from "@/components/optimizer/module-tabs";
import { CX_SEARCH } from "./cx-nav";
import { CustomizeMenuDialog } from "./customize-menu";
import { ALL_TOOLS } from "./nav";
import { useUiPrefs } from "./ui-prefs";

type Suggestion = { label: string; sub: string; href: string };

const isCx = (pathname: string) => pathname === "/cx" || pathname.startsWith("/cx/");

/** "surface" = the SEO workspace's light topbar; "brand" = the CX workspace's dark brand-blue header. */
export type BarVariant = "surface" | "brand";
export const iconBtn = (variant: BarVariant = "surface") =>
  variant === "brand" ? "rounded-md p-2 text-[var(--cx-header-muted)] hover:bg-white/10 hover:text-white" : "rounded-md p-2 text-text-2 hover:bg-surface-3 hover:text-text";

export function GlobalSearch({ variant = "surface", className }: { variant?: BarVariant; className?: string }) {
  const router = useRouter();
  const cx = isCx(usePathname());
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.querySelector("input")?.focus();
      }
    };
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  const suggestions = useMemo<Suggestion[]>(() => {
    const value = q.trim();
    if (cx) {
      // CX workspace: every CX page (including ones hidden from the menu) and settings, plus ticket search.
      if (!value) return CX_SEARCH.slice(0, 7).map((t) => ({ label: t.label, sub: t.description, href: t.href }));
      const needle = value.toLowerCase();
      const pages = CX_SEARCH.filter((t) => `${t.label} ${t.group} ${t.description}`.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.label.toLowerCase().includes(needle)) - Number(!b.label.toLowerCase().includes(needle)))
        .map((t) => ({ label: t.group && t.group !== t.label ? `${t.label} · ${t.group}` : t.label, sub: t.description, href: t.href }));
      return [...pages.slice(0, 7), { label: `Search tickets for "${value}"`, sub: "Subject, message text, contact or ticket number", href: `/cx/inbox?view=all&q=${encodeURIComponent(value)}` }];
    }
    if (!value) return ALL_TOOLS.slice(2, 8).map((t) => ({ label: t.label, sub: t.description, href: t.href }));
    const c = classifyQuery(value);
    const enc = encodeURIComponent(c.value);
    const out: Suggestion[] = [];
    if (c.kind === "domain" || c.kind === "url") {
      const domain = c.kind === "url" ? new URL(c.value).hostname.replace(/^www\./, "") : c.value;
      const d = encodeURIComponent(domain);
      out.push(
        { label: `Domain Overview · ${domain}`, sub: "Authority, traffic, keywords and backlinks", href: `/domain-overview?q=${d}` },
        { label: `Organic Research · ${domain}`, sub: "Rankings, pages and competitors", href: `/organic-research?q=${d}` },
        { label: `Backlink Analytics · ${domain}`, sub: "Referring domains, anchors, velocity", href: `/backlink-analytics?q=${d}` },
        { label: `Traffic Analytics · ${domain}`, sub: "Visits, channels, audience", href: `/traffic-analytics?q=${d}` },
      );
      if (c.kind === "url") out.push({ label: `SEO Content Template · ${c.value}`, sub: "Brief from the page's keyword", href: `/seo-content-template?q=${enc}` });
    } else {
      out.push(
        { label: `Keyword Overview · ${c.value}`, sub: "Volume, difficulty, intent, SERP", href: `/keyword-overview?q=${enc}` },
        { label: `Keyword Magic Tool · ${c.value}`, sub: "Thousands of related keyword ideas", href: `/keyword-magic-tool?q=${enc}` },
        { label: `Topic Research · ${c.value}`, sub: "Content ideas and questions", href: `/topic-research?q=${enc}` },
      );
    }
    const needle = value.toLowerCase();
    for (const t of ALL_TOOLS) if (t.label.toLowerCase().includes(needle)) out.push({ label: t.label, sub: t.description, href: t.href });
    return out.slice(0, 8);
  }, [q, cx]);

  const go = (s?: Suggestion) => {
    const target = s ?? suggestions[active];
    if (!target) return;
    setOpen(false);
    setQ("");
    router.push(target.href);
  };

  return (
    <div ref={ref} className={cn("relative w-full max-w-xl", className)}>
      <Search className={cn("pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2", variant === "brand" ? "text-[var(--cx-header-muted)]" : "text-text-3")} />
      <input
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true), setActive(0))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, suggestions.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), go());
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={cx ? (variant === "brand" ? "Search" : "Search CX pages, settings or tickets") : "Search a domain, URL or keyword"}
        className={cn(
          "h-9 w-full rounded-lg pr-14 pl-9 text-[13.5px] focus:outline-none",
          variant === "brand"
            ? "border border-transparent bg-[var(--cx-header-field)] text-white placeholder:text-[var(--cx-header-muted)] focus:border-white/40 focus:bg-white/20"
            : "border border-border bg-surface-2 placeholder:text-text-3 focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20",
        )}
        aria-label="Global search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-list"
      />
      <kbd className={cn("pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border px-1.5 text-[10.5px] sm:block", variant === "brand" ? "border-white/20 text-[var(--cx-header-muted)]" : "border-border bg-surface text-text-3")}>⌘K</kbd>
      {open && suggestions.length > 0 && (
        <ul id="global-search-list" role="listbox" className="absolute z-50 mt-1 w-full min-w-72 overflow-hidden rounded-lg border border-border bg-surface py-1 text-text shadow-pop">
          {!q.trim() && <li className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-text-3 uppercase">{cx ? "Go to" : "Popular tools"}</li>}
          {suggestions.map((s, i) => (
            <li key={s.href + s.label} role="option" aria-selected={i === active}>
              <button onMouseEnter={() => setActive(i)} onClick={() => go(s)} className={cn("flex w-full flex-col px-3 py-1.5 text-left", i === active && "bg-surface-3")}>
                <span className="text-[13px] text-text">{s.label}</span>
                <span className="text-[11.5px] text-text-3">{s.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Switch between the SEO workspace and the CX (customer experience) workspace. */
export function WorkspaceSwitch({ variant = "surface" }: { variant?: BarVariant }) {
  const pathname = usePathname();
  const cx = pathname === "/cx" || pathname.startsWith("/cx/");
  const item = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1 text-[12.5px] font-semibold transition-colors",
        variant === "brand" ? (active ? "bg-white text-[var(--cx-header)]" : "text-[var(--cx-header-muted)] hover:text-white") : active ? "bg-brand text-white shadow-card" : "text-text-2 hover:text-text",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Workspace" className={cn("flex shrink-0 items-center gap-0.5 rounded-lg p-0.5", variant === "brand" ? "border border-white/20 bg-white/5" : "border border-border bg-surface-2")}>
      {item("/dashboard", "SEO", !cx)}
      {item("/cx", "CX", cx)}
    </nav>
  );
}

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);
  const set = (next: boolean) => {
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("synapse.theme", next ? "dark" : "light");
    } catch {}
  };
  return [dark, set] as const;
}

export function ThemeToggle({ className, variant }: { className?: string; variant?: BarVariant }) {
  const [dark, set] = useTheme();
  return (
    <button onClick={() => set(!dark)} className={cn(iconBtn(variant), className)} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

const SHORTCUT = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘\\" : "Ctrl+\\";

/** Focus mode: one-click toggle; while on, a visible "Focus mode ×" pill exits it. */
export function FocusToggle({ variant }: { variant?: BarVariant }) {
  const { prefs, update } = useUiPrefs();
  const [hint, setHint] = useState("");
  useEffect(() => setHint(SHORTCUT), []);
  if (prefs.focus)
    return (
      <button
        onClick={() => update({ focus: false })}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2.5 text-[12.5px] font-semibold text-brand-ink hover:border-brand"
        title={`Exit focus mode (${hint || "Esc"})`}
        aria-label="Exit focus mode"
      >
        <Focus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Focus mode</span>
        <X className="h-3.5 w-3.5" />
      </button>
    );
  return (
    <button onClick={() => update({ focus: true })} className={cn("hidden sm:block", iconBtn(variant))} title={`Focus mode (${hint})`} aria-label="Turn on focus mode">
      <Focus className="h-4 w-4" />
    </button>
  );
}

/** Display preferences: focus mode, density, theme, menu customisation, hidden panels. */
export function DisplayMenu({ variant }: { variant?: BarVariant }) {
  const { prefs, update } = useUiPrefs();
  const cx = isCx(usePathname());
  const router = useRouter();
  const [dark, setDark] = useTheme();
  const [customizing, setCustomizing] = useState(false);
  const hiddenCount = Object.values(prefs.panels).filter((p) => p.state === "hidden").length;
  return (
    <>
      <Menu
        align="right"
        className="w-72"
        trigger={(open) => (
          <button className={cn(iconBtn(variant), open && (variant === "brand" ? "bg-white/10 text-white" : "bg-surface-3 text-text"))} aria-label="Display options" aria-expanded={open} title="Display options">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <div className="text-[13px]">
            <div className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Display</div>
            <button type="button" onClick={() => (close(), update({ focus: !prefs.focus }))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-3">
              <Focus className="h-4 w-4 text-text-3" />
              <span className="flex-1">Focus mode</span>
              {prefs.focus ? <Check className="h-4 w-4 text-brand-ink" /> : <kbd className="rounded border border-border px-1 text-[10.5px] text-text-3">{SHORTCUT}</kbd>}
            </button>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-text-2">Density</span>
              <Segmented size="sm" value={prefs.density} onChange={(v) => update({ density: v })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-text-2">Theme</span>
              <Segmented size="sm" value={dark ? "dark" : "light"} onChange={(v) => setDark(v === "dark")} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
            </div>
            {(cx || hiddenCount > 0) && <div className="my-1 border-t border-border" />}
            {cx && (
              <MenuItem icon={<SlidersHorizontal className="h-4 w-4 text-text-3" />} onClick={() => (close(), setCustomizing(true))}>
                Customize menu…
              </MenuItem>
            )}
            {hiddenCount > 0 && (
              <MenuItem icon={<RotateCcw className="h-4 w-4 text-text-3" />} onClick={() => (close(), update({ panels: restorePanels(prefs.panels) }).then(() => router.refresh()))}>
                Show all hidden panels ({hiddenCount})
              </MenuItem>
            )}
          </div>
        )}
      </Menu>
      {cx && <CustomizeMenuDialog open={customizing} onClose={() => setCustomizing(false)} />}
    </>
  );
}

/** Notification bell with the unread badge (links to Alerts). */
export function AlertsBell({ unread, variant }: { unread: number; variant?: BarVariant }) {
  return (
    <Link href="/alerts" className={cn("relative", iconBtn(variant))} aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} title="Alerts">
      <Bell className="h-4 w-4" />
      {unread > 0 && <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

/** Avatar menu: account, settings, sign out. `extra` adds workspace-specific entries. */
export function AccountMenu({ user, logoutAction, variant, extra }: { user: { name: string; email: string }; logoutAction: () => Promise<void>; variant?: BarVariant; extra?: ReactNode }) {
  return (
    <Menu
      align="right"
      trigger={() => (
        <button className={cn("ml-1 flex items-center gap-2 rounded-md p-1", variant === "brand" ? "hover:bg-white/10" : "hover:bg-surface-3")} aria-label="Account menu">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold uppercase", variant === "brand" ? "bg-white text-[var(--cx-header)]" : "bg-brand text-white")}>{(user.name || user.email)[0]}</span>
        </button>
      )}
    >
      <div className="border-b border-border px-3 py-2">
        <div className="text-[13px] font-medium text-text">{user.name || "Account"}</div>
        <div className="truncate text-[12px] text-text-3">{user.email}</div>
      </div>
      {extra}
      <MenuItem href="/settings" icon={<Settings className="h-4 w-4 text-text-3" />}>
        Account settings
      </MenuItem>
      <MenuItem href="/settings?tab=profile" icon={<User className="h-4 w-4 text-text-3" />}>
        Profile
      </MenuItem>
      <form action={logoutAction}>
        <button type="submit" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text hover:bg-surface-3">
          <LogOut className="h-4 w-4 text-text-3" /> Sign out
        </button>
      </form>
    </Menu>
  );
}

/** SEO workspace topbar with the Pre-Publish Optimizer module tabs as its second row (the CX workspace uses <CxHeader>). */
export function Topbar({ user, unread, onMenu, logoutAction }: { user: { name: string; email: string }; unread: number; onMenu: () => void; logoutAction: () => Promise<void> }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <button onClick={onMenu} className="rounded-md p-2 text-text-2 hover:bg-surface-3 lg:hidden" aria-label="Open navigation">
          <MenuIcon className="h-5 w-5" />
        </button>
        <WorkspaceSwitch />
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-1">
          <FocusToggle />
          <DisplayMenu />
          <ThemeToggle className="hidden sm:block" />
          <AlertsBell unread={unread} />
          <AccountMenu user={user} logoutAction={logoutAction} />
        </div>
      </div>
      <OptimizerTabs />
    </header>
  );
}
