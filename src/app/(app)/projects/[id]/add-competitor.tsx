"use client";

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addCompetitorAction } from "../actions";

/** One-click "Add as competitor" for suggested domains. */
export function AddCompetitorButton({ projectId, domain, disabled }: { projectId: string; domain: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[11.5px] text-critical-ink">{error}</span>}
      <Button
        size="sm"
        variant={done ? "ghost" : "secondary"}
        loading={pending}
        disabled={disabled || done}
        onClick={() =>
          start(async () => {
            const res = await addCompetitorAction(projectId, domain);
            if (!res.ok) return setError(res.error);
            setDone(true);
            router.refresh();
          })
        }
        aria-label={`Add ${domain} as a competitor`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : !pending && <Plus className="h-3.5 w-3.5" />}
        {done ? "Added" : "Add"}
      </Button>
    </span>
  );
}
