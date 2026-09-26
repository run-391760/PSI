import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page container with consistent padding and max width. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 py-5 sm:px-6", wide ? "max-w-[1600px]" : "max-w-[1400px]", className)}>{children}</div>;
}

/**
 * Report header: breadcrumbs, title (+ subject such as the domain or keyword), meta badges
 * (data source, database) and actions. `children` renders below (usually a ToolSearch).
 */
export function PageHeader({
  title,
  subject,
  description,
  breadcrumbs,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subject?: ReactNode;
  description?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-[12px] text-text-3" aria-label="Breadcrumb">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {b.href ? (
                <Link href={b.href} className="hover:text-text">
                  {b.label}
                </Link>
              ) : (
                <span>{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-2 text-[22px] font-semibold tracking-tight text-text">
            <span>{title}</span>
            {subject && <span className="font-normal text-text-2">{subject}</span>}
          </h1>
          {description && <p className="mt-1 max-w-3xl text-[13px] text-text-2">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="no-print mt-4">{children}</div>}
    </div>
  );
}

/** Responsive grid for dashboard cards. */
export function Grid({ children, cols = 3, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: "", 2: "lg:grid-cols-2", 3: "md:grid-cols-2 xl:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4" }[cols];
  return <div className={cn("grid grid-cols-1 gap-4", c, className)}>{children}</div>;
}

/** Temporary placeholder for tools under construction. */
export function ToolPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <div className="rounded-lg border border-dashed border-border-strong bg-surface px-6 py-16 text-center text-text-2">This tool is being built.</div>
    </Page>
  );
}
