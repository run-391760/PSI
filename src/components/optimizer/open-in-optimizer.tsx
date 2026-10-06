"use client";

import { Gauge } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDraftAction } from "@/app/(app)/optimizer/actions";
import { Button } from "@/components/ui/button";

/** Import a live page into the Pre-Publish Optimizer as a draft (keyword, URL and market prefilled) and open it. */
export function OpenInOptimizerButton({ keyword, url, db, label = "Optimize in Pre-Publish Optimizer" }: { keyword: string; url: string; db?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        loading={busy}
        title="Imports the page's content, title, meta description, canonical and schema as a new optimizer draft"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await createDraftAction({ keyword, importUrl: url, db });
          if (!r.ok) {
            setBusy(false);
            return setError(r.error);
          }
          router.push(`/optimizer?doc=${r.data.id}`);
        }}
      >
        {!busy && <Gauge className="h-4 w-4" />} {label}
      </Button>
      {error && (
        <span role="alert" className="max-w-[320px] text-[12.5px] text-critical-ink">
          {error}
        </span>
      )}
    </span>
  );
}
