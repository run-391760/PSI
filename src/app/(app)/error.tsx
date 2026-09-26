"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Callout tone="critical" title="This report could not be loaded">
        <p className="mt-1">{error.message || "An unexpected error occurred."}</p>
        {error.digest && <p className="mt-1 text-[12px] text-text-3">Reference: {error.digest}</p>}
      </Callout>
      <Button className="mt-4" onClick={reset}>
        <RotateCcw className="h-4 w-4" /> Try again
      </Button>
    </div>
  );
}
