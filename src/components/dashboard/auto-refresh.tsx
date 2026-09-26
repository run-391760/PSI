"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the server-rendered page every `interval` ms while `active` (e.g. jobs are running). */
export function AutoRefresh({ active, interval = 3000 }: { active: boolean; interval?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, interval);
    return () => clearInterval(t);
  }, [active, interval, router]);
  return null;
}
