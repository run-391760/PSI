"use client";

import { PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openInWritingAssistantAction } from "@/app/(app)/seo-content-template/actions";
import { Button } from "@/components/ui/button";

/** Creates a Writing Assistant document prefilled with the template's targets, then opens it. */
export function OpenInWritingAssistant({ q, db }: { q: string; db: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant="primary"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await openInWritingAssistantAction(q, db);
            if (res.ok) router.push(`/writing-assistant/${res.data.id}`);
            else setError(res.error);
          })
        }
      >
        {!pending && <PenLine className="h-4 w-4" />} Open in Writing Assistant
      </Button>
      {error && <span className="mt-1 text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}
