import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 select-none";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover shadow-card",
  secondary: "bg-surface text-text border border-border-strong hover:bg-surface-3 shadow-card",
  ghost: "text-text-2 hover:bg-surface-3 hover:text-text",
  danger: "bg-critical text-white hover:opacity-90",
  link: "text-link hover:underline px-0 h-auto",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12.5px]",
  md: "h-8.5 px-3.5 text-[13px]",
  lg: "h-10 px-5 text-sm",
  icon: "h-8 w-8",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], variant === "link" ? "" : sizes[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  loading,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  // `loading` must win over an explicit disabled={false}, so it is applied after the spread.
  return (
    <button {...props} className={buttonClass(variant, size, className)} disabled={loading || disabled} aria-busy={loading || undefined}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string; variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
