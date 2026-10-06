"use client";

import { X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = { md: "max-w-[760px]", lg: "max-w-[860px]" };

/**
 * Right-side panel on the native <dialog> (top layer, focus trap and focus restore). Esc and a
 * backdrop click close it; a child that handles Esc itself (a Menu, a nested Dialog) wins.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  size?: keyof typeof WIDTHS;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    if (!d.open) d.showModal();
    // The panel itself takes focus (not the X), so Tab starts at its first control.
    d.focus({ preventScroll: true });
    const html = document.documentElement;
    const gutter = window.innerWidth - html.clientWidth;
    const prev = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
    html.style.overflow = "hidden";
    if (gutter > 0) html.style.paddingRight = `${gutter}px`;
    return () => {
      html.style.overflow = prev.overflow;
      html.style.paddingRight = prev.paddingRight;
      if (d.open) d.close(); // also restores focus to the opener
    };
  }, [open]);
  // Both press and release must land on the backdrop, so a text selection dragged out of the panel never closes it.
  const onBackdrop = (e: ReactMouseEvent<HTMLDialogElement>) => {
    const d = ref.current;
    if (!d || e.target !== d) return false;
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault(); // the parent closes it by setting open=false, so onClose fires once
    onClose();
  };
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // Esc that bypassed onKeyDown, or the Android back gesture.
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        // The browser closed it on its own while still open: report it once.
        if (open) onClose();
      }}
      onMouseDown={(e) => (downOnBackdrop.current = onBackdrop(e))}
      onMouseUp={(e) => {
        const close = downOnBackdrop.current && onBackdrop(e);
        downOnBackdrop.current = false;
        if (close) onClose();
      }}
      className={cn("dialog-panel fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full border-0 border-border bg-surface p-0 text-text shadow-modal outline-none sm:border-l", WIDTHS[size])}
    >
      {open && (
        <div className="flex h-full flex-col max-sm:pb-[env(safe-area-inset-bottom)]">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5 sm:py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="line-clamp-2 text-[16px] leading-snug font-semibold break-words">
                {title}
              </h2>
              {subtitle && <div className="mt-1 text-[12.5px] text-text-2">{subtitle}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <button type="button" onClick={onClose} className="-my-1.5 -mr-2 inline-flex h-9.5 w-9.5 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
