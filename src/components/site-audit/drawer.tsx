"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback } from "react";
import { Drawer } from "@/components/position-tracking/drawer";

/**
 * Right-hand drawer whose open state lives in the URL (`param`, default "page"). Closing removes the
 * param (Esc, backdrop click or the close button). Content is rendered on the server and passed in.
 * Built on the shared native-<dialog> Drawer, so focus is trapped and returns to the opener.
 */
export function UrlDrawer({ title, subtitle, children, param = "page", actions }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; param?: string; actions?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const close = useCallback(() => {
    const p = new URLSearchParams(search.toString());
    p.delete(param);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [router, pathname, search, param]);
  return (
    <Drawer open onClose={close} size="lg" title={<span className="break-all">{title}</span>} subtitle={subtitle && <div className="flex flex-wrap items-center gap-2 text-text-3">{subtitle}</div>} actions={actions}>
      {children}
    </Drawer>
  );
}
