"use client";

import { FileDown } from "lucide-react";
import { Button } from "./button";

/** Exports the current report via the browser's print-to-PDF (print CSS hides navigation). */
export function PrintButton({ label = "Export PDF" }: { label?: string }) {
  return (
    <Button onClick={() => window.print()}>
      <FileDown className="h-4 w-4" /> {label}
    </Button>
  );
}
