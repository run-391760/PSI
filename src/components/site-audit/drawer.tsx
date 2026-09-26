"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

/**
 * Right-hand drawer whose open state lives in the URL (`param`, default "page"). Closing removes the
 * param (Esc, backdrop click or the close button). Content is rendered on the server and passed in.
 */
export function UrlDrawer({ title, subtitle, children, param = "page", actions }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; param?: string; actions?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    const p = new URLSearchParams(search.toString());
    p.delete(param);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [router, pathname, search, param]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-black/35" onClick={close} />
      <div ref={panel} tabIndex={-1} style={{ outline: "none" }} className="relative flex h-full w-full max-w-[860px] flex-col border-l border-border bg-surface shadow-modal">
        <div className="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold break-all text-text">{title}</div>
            {subtitle && <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-text-3">{subtitle}</div>}
          </div>
          {actions}
          <button type="button" onClick={close} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}
