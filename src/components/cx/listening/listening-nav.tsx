import Link from "next/link";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/cx/listening", label: "Mentions" },
  { href: "/cx/listening/dashboards", label: "Dashboards" },
  { href: "/cx/listening/topics", label: "Topics & sources" },
  { href: "/cx/crisis", label: "Crisis" },
];

/** Section nav shared by the listening and crisis pages (keeps ?brand=). */
export function ListeningNav({ current, brandId, counts }: { current: string; brandId: string; counts?: Record<string, number | undefined> }) {
  return (
    <nav className="scroll-thin mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Listening sections">
      {ITEMS.map((it) => {
        const active = it.href === current;
        const c = counts?.[it.href];
        return (
          <Link
            key={it.href}
            href={`${it.href}?brand=${brandId}`}
            aria-current={active ? "page" : undefined}
            className={cn("relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap", active ? "border-brand text-text" : "border-transparent text-text-2 hover:text-text")}
          >
            {it.label}
            {c ? <span className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{c}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
