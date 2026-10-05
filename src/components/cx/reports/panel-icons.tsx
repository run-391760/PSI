"use client";

import { Copy, Download, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** REPORTS panel header icons: save as a custom report, one-click report, download centre (keep ?brand=). */
export function ReportsPanelIcons() {
  const sp = useSearchParams();
  const brand = sp.get("brand");
  const h = (p: string) => (brand ? `${p}?brand=${encodeURIComponent(brand)}` : p);
  return (
    <>
      <Link href={h("/cx/reports/custom")} title="Duplicate as a custom report" aria-label="Duplicate as a custom report">
        <Copy className="h-3.5 w-3.5" />
      </Link>
      <Link href={h("/cx/reports/one-click")} title="Customise: one-click report" aria-label="One-click report">
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </Link>
      <Link href={h("/cx/reports/download")} title="Download centre" aria-label="Download centre">
        <Download className="h-3.5 w-3.5" />
      </Link>
    </>
  );
}
