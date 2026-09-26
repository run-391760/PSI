import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-text placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-8.5", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237a8494' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundSize: "14px",
  backgroundPosition: "right 8px center",
  backgroundRepeat: "no-repeat",
};

/** Native select. The chevron is an inline style so background-color classes can't displace it. */
export function Select({ className, children, style, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(field, "h-8.5 cursor-pointer appearance-none pr-7", className)} style={{ ...CHEVRON, ...style }} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, children, ...props }: ComponentProps<"label">) {
  return (
    <label className={cn("mb-1 block text-[12.5px] font-medium text-text-2", className)} {...props}>
      {children}
    </label>
  );
}

export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="mt-1 text-[12px] text-critical-ink">{error}</p> : hint ? <p className="mt-1 text-[12px] text-text-3">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return <input type="checkbox" className={cn("h-3.5 w-3.5 cursor-pointer rounded border-border-strong accent-[var(--brand)]", className)} {...props} />;
}
