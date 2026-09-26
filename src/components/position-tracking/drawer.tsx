"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/** Right-side panel on the native <dialog> (focus trap, Esc and backdrop click close it). */
export function Drawer({ open, onClose, title, subtitle, actions, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      closeRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-[760px] border-l border-border bg-surface p-0 text-text shadow-modal backdrop:bg-black/40"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold">{title}</h2>
              {subtitle && <div className="mt-1 text-[12.5px] text-text-2">{subtitle}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <button ref={closeRef} onClick={onClose} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
