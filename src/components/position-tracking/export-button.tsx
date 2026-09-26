"use client";

import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";

/** Downloads precomputed rows as CSV (server components pass plain arrays). */
export function ExportButton({ name, rows, label = "Export", size = "sm" }: { name: string; rows: (string | number | null)[][]; label?: string; size?: "sm" | "md" }) {
  return (
    <Button size={size} onClick={() => downloadCsv(name, rows)} disabled={rows.length <= 1} title="Download as CSV">
      <Download className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}
