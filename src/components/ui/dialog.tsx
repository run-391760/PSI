"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Modal built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-left text-text shadow-modal backdrop:bg-black/40",
        { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size],
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-text-2">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Dropdown menu: click the trigger to open; closes on outside click / Esc. */
export function Menu({ trigger, children, align = "left", className }: { trigger: (open: boolean) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div className={cn("absolute z-50 mt-1 min-w-48 rounded-lg border border-border bg-surface py-1 shadow-pop", align === "right" ? "right-0" : "left-0", className)}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, href, danger, icon }: { children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; icon?: ReactNode }) {
  const cls = cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-3", danger ? "text-critical-ink" : "text-text");
  if (href)
    return (
      <a href={href} className={cls}>
        {icon}
        {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {icon}
      {children}
    </button>
  );
}
