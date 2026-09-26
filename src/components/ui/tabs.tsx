"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export type TabItem = { href: string; label: ReactNode; count?: ReactNode; match?: string };

/**
 * URL-driven tabs. An item is active when its path + `tab` query param match the current URL.
 * Pass `param` (default "tab") to use a different query key. Other query params are preserved.
 */
export function TabsNav({ items, param = "tab", className }: { items: TabItem[]; param?: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const currentTab = search.get(param);
  const tabOf = (href: string) => new URL(href, "http://x").searchParams.get(param);
  const onPath = (href: string) => new URL(href, "http://x").pathname === pathname;
  // Exact match first; otherwise the tab without a param (the default) is active; otherwise the first.
  let activeIndex = items.findIndex((it) => onPath(it.href) && tabOf(it.href) === currentTab);
  if (activeIndex < 0) activeIndex = items.findIndex((it) => onPath(it.href) && !tabOf(it.href));
  if (activeIndex < 0 && !currentTab) activeIndex = items.findIndex((it) => onPath(it.href));
  return (
    <nav className={cn("scroll-thin flex gap-1 overflow-x-auto border-b border-border", className)} aria-label="Sections">
      {items.map((item, i) => {
        const url = new URL(item.href, "http://x");
        const tab = url.searchParams.get(param);
        const active = i === activeIndex;
        // Preserve other params (q, db, project...) when switching tabs.
        const merged = new URLSearchParams(search.toString());
        url.searchParams.forEach((v, k) => merged.set(k, v));
        if (!tab) merged.delete(param);
        return (
          <Link
            key={item.href}
            href={`${url.pathname}?${merged.toString()}`}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              active ? "border-brand text-text" : "border-transparent text-text-2 hover:text-text",
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            {item.count != null && <span className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{item.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Local-state tabs for switching views inside a card. */
export function Tabs({
  tabs,
  className,
  initial,
  variant = "underline",
}: {
  tabs: { id: string; label: ReactNode; content: ReactNode }[];
  className?: string;
  initial?: string;
  variant?: "underline" | "pill";
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  return (
    <div className={className}>
      <div role="tablist" className={cn("scroll-thin flex gap-1 overflow-x-auto", variant === "underline" ? "border-b border-border px-4" : "px-4 pb-2")}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "text-[12.5px] font-medium whitespace-nowrap transition-colors",
              variant === "underline"
                ? cn("-mb-px border-b-2 px-2.5 py-2", active === t.id ? "border-brand text-text" : "border-transparent text-text-2 hover:text-text")
                : cn("rounded-md px-2.5 py-1", active === t.id ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:bg-surface-3"),
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tabs.find((t) => t.id === active)?.content}</div>
    </div>
  );
}

/** Segmented control (e.g. 1M / 6M / 1Y / 2Y, Desktop / Mobile). */
export function Segmented<T extends string>({ options, value, onChange, className, size = "sm" }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex rounded-md border border-border-strong bg-surface p-0.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("shrink-0 rounded px-2.5 font-medium whitespace-nowrap transition-colors", size === "sm" ? "h-6 text-[12px]" : "h-7 text-[13px]", value === o.value ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
