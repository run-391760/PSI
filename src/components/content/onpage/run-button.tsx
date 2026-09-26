"use client";

import { Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startRunAction } from "@/app/(app)/on-page-checker/actions";
import { Button } from "@/components/ui/button";

/** Starts the "content.onpage" job for a project. */
export function RunButton({ projectId, rerun, disabled, size = "md", variant = "primary" }: { projectId: string; rerun?: boolean; disabled?: boolean; size?: "sm" | "md"; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await startRunAction(projectId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        {!pending && (rerun ? <RefreshCw className="h-4 w-4" /> : <Play className="h-4 w-4" />)}
        {rerun ? "Recollect ideas" : "Collect ideas"}
      </Button>
      {error && <span className="mt-1 max-w-64 text-right text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}
