import { Database, Plug } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PROVIDER_INFO, type Provider } from "@/lib/data-mode";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shown instead of numbers when a report needs an API that is not connected. Lists what the report
 * would show and exactly what to configure. Never pair it with synthetic data.
 */
export function NeedsData({
  providers,
  title,
  shows,
  children,
  className,
  compact,
}: {
  providers: Provider[];
  title?: string;
  /** What this report shows once connected (bullets). */
  shows?: string[];
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const infos = providers.map((p) => ({ id: p, ...PROVIDER_INFO[p] }));
  const env = [...new Set(infos.flatMap((i) => i.env))];
  const href = infos[0]?.href ?? "/settings?tab=integrations";
  return (
    <Card className={cn(compact ? "p-4" : "px-6 py-8", className)}>
      <div className={cn("flex gap-4", compact ? "items-start" : "flex-col items-center text-center")}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Plug className="h-5 w-5" />
        </span>
        <div className={cn("w-full min-w-0 break-words", !compact && "max-w-xl")}>
          <h3 className="text-[15px] font-semibold text-text">{title ?? `Connect ${infos.map((i) => i.name).join(" or ")} to see this report`}</h3>
          <p className="mt-1 text-[13px] text-text-2">{infos.map((i) => i.description).join(" ")}</p>
          {shows && shows.length > 0 && (
            <ul className={cn("mt-3 grid gap-1 text-[12.5px] text-text-2", !compact && "text-left sm:grid-cols-2")}>
              {shows.map((s) => (
                <li key={s} className="flex items-start gap-1.5">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" />
                  {s}
                </li>
              ))}
            </ul>
          )}
          {env.length > 0 && (
            <p className="mt-3 text-[12px] text-text-3">
              Server settings: {env.map((e) => <code key={e} className="mx-0.5 rounded bg-surface-3 px-1 py-0.5 text-text-2">{e}</code>)}
            </p>
          )}
          {children}
          <div className={cn("mt-4", !compact && "flex justify-center")}>
            <Link href={href} className={buttonClass("secondary", "sm")}>
              How to connect
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
