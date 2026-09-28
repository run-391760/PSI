"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** Switch the active CX brand (?brand=<projectId>) on the current page. */
export function BrandSwitcher({ brands, current, className }: { brands: { id: string; name: string; domain: string }[]; current: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <select
      value={current}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        params.set("brand", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className={cn("h-8 max-w-60 rounded-md border border-border-strong bg-surface px-2 text-[13px] focus:outline-none", className)}
      aria-label="Brand"
    >
      {brands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} ({b.domain})
        </option>
      ))}
    </select>
  );
}
