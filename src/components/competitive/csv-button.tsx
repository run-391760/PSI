"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";

/** Export prepared rows (first row = header) as CSV. For server-rendered widgets and grids. */
export function CsvButton({ filename, rows, label = "Export", className }: { filename: string; rows: (string | number | null)[][]; label?: string; className?: string }) {
  return (
    <Button size="sm" onClick={() => downloadCsv(filename, rows)} className={className} title="Download as CSV">
      <Download className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}
