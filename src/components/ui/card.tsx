import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoTip } from "./tooltip";

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("rounded-lg border border-border bg-surface shadow-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  info,
  actions,
  className,
  href,
}: {
  title: ReactNode;
  description?: ReactNode;
  info?: string;
  actions?: ReactNode;
  className?: string;
  href?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-4 pt-3.5 pb-2", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-text">
          {href ? (
            <a href={href} className="hover:text-link">
              {title}
            </a>
          ) : (
            title
          )}
          {info && <InfoTip text={info} />}
        </h2>
        {description && <p className="mt-0.5 text-[12.5px] text-text-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-4 pb-4", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <footer className={cn("border-t border-border px-4 py-2.5 text-[12.5px]", className)}>{children}</footer>;
}
