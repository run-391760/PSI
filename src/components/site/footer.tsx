import Link from "next/link";
import { FOOTER_LINKS, SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Footer for public pages (sign-in, register, About, Privacy Policy, Contact Us). */
export function SiteFooter({ className, current }: { className?: string; current?: string }) {
  return (
    <footer className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] text-text-3", className)}>
      <nav aria-label="Site" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {FOOTER_LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined} className={cn("hover:text-text hover:underline", current === l.href && "font-medium text-text")}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span>© {new Date().getFullYear()} {SITE.operator}</span>
    </footer>
  );
}
