"use client";

import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { MODULES } from "@/lib/optimizer/features";
import { cn } from "@/lib/utils";

/**
 * Top navigation of the SEO workspace: the Pre-Publish Optimizer's dashboard and one tab per module
 * (names exactly as in the feature list), in the CX header's tab style (12px semibold uppercase, 3px
 * active underline). Keeps the open draft (?doc=) when switching tabs.
 */
export function OptimizerTabs() {
  const pathname = usePathname();
  const search = useSearchParams();
  const doc = pathname.startsWith("/optimizer") ? search.get("doc") : null;
  const ref = useRef<HTMLElement>(null);
  const active = pathname === "/optimizer" ? "dashboard" : pathname.startsWith("/optimizer/") ? pathname.split("/")[2] : null;
  const href = (p: string) => (doc ? `${p}?doc=${encodeURIComponent(doc)}` : p);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-current='page']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const tab = (id: string, label: string, to: string, icon?: React.ReactNode) => {
    const on = active === id;
    return (
      <Link
        key={id}
        href={href(to)}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex h-full shrink-0 items-center gap-1.5 border-b-[3px] px-3 pt-[3px] text-[12px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase transition-colors",
          on ? "border-brand bg-brand-soft/50 text-brand-ink" : "border-transparent text-text-2 hover:bg-surface-2 hover:text-text",
        )}
      >
        {icon}
        {label}
      </Link>
    );
  };

  return (
    <nav ref={ref} aria-label="Pre-publish optimizer modules" className="opt-tabs flex h-10 items-stretch overflow-x-auto border-t border-border px-1 sm:px-2">
      {tab("dashboard", "Optimizer", "/optimizer", <ClipboardCheck className="h-3.5 w-3.5" />)}
      <span className="mx-1 my-3 w-px shrink-0 bg-border" aria-hidden />
      {MODULES.map((m) => tab(m.id, m.label, `/optimizer/${m.id}`))}
    </nav>
  );
}
