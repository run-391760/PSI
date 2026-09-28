"use client";

import { Bell, LogOut, Menu as MenuIcon, Moon, Search, Settings, Sun, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { classifyQuery } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { ALL_TOOLS } from "./nav";

type Suggestion = { label: string; sub: string; href: string };

function GlobalSearch() {
  const router = useRouter();
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
  }, [q]);

  const go = (s?: Suggestion) => {
    const target = s ?? suggestions[active];
    if (!target) return;
    setOpen(false);
    setQ("");
    router.push(target.href);
  };

  return (
    <div ref={ref} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-3" />
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
        placeholder="Search a domain, URL or keyword"
        className="h-9 w-full rounded-lg border border-border bg-surface-2 pr-14 pl-9 text-[13.5px] placeholder:text-text-3 focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/20 focus:outline-none"
        aria-label="Global search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-list"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border bg-surface px-1.5 text-[10.5px] text-text-3 sm:block">⌘K</kbd>
      {open && suggestions.length > 0 && (
        <ul id="global-search-list" role="listbox" className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop">
          {!q.trim() && <li className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Popular tools</li>}
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
function WorkspaceSwitch() {
  const pathname = usePathname();
  const cx = pathname === "/cx" || pathname.startsWith("/cx/");
  const item = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-md px-2.5 py-1 text-[12.5px] font-semibold transition-colors", active ? "bg-brand text-white shadow-card" : "text-text-2 hover:text-text")}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Workspace" className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
      {item("/dashboard", "SEO", !cx)}
      {item("/cx", "CX", cx)}
    </nav>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("synapse.theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-md p-2 text-text-2 hover:bg-surface-3 hover:text-text" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function Topbar({ user, unread, onMenu, logoutAction }: { user: { name: string; email: string }; unread: number; onMenu: () => void; logoutAction: () => Promise<void> }) {
  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
      <button onClick={onMenu} className="rounded-md p-2 text-text-2 hover:bg-surface-3 lg:hidden" aria-label="Open navigation">
        <MenuIcon className="h-5 w-5" />
      </button>
      <WorkspaceSwitch />
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <Link href="/alerts" className="relative rounded-md p-2 text-text-2 hover:bg-surface-3 hover:text-text" aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="h-4 w-4" />
          {unread > 0 && <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <Menu
          align="right"
          trigger={() => (
            <button className="ml-1 flex items-center gap-2 rounded-md p-1 hover:bg-surface-3" aria-label="Account menu">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-white uppercase">{(user.name || user.email)[0]}</span>
            </button>
          )}
        >
          <div className="border-b border-border px-3 py-2">
            <div className="text-[13px] font-medium text-text">{user.name || "Account"}</div>
            <div className="text-[12px] text-text-3">{user.email}</div>
          </div>
          <MenuItem href="/settings" icon={<Settings className="h-4 w-4 text-text-3" />}>
            Settings
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
      </div>
    </header>
  );
}
