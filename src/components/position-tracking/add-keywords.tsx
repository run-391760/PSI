"use client";

import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { addKeywordsAction } from "@/app/(app)/position-tracking/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { KeywordInput, type Suggestion, type parseKeywords } from "./keyword-input";

/** "Add keywords" button + dialog (paste, CSV, suggestions, tags). Opens automatically for ?import=. */
export function AddKeywordsButton({
  projectId,
  existing,
  remaining,
  suggestions,
  tagNames,
  prefill = [],
  variant = "primary",
}: {
  projectId: string;
  existing: string[];
  remaining: number;
  suggestions: Suggestion[];
  tagNames: string[];
  prefill?: string[];
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(prefill.length > 0);
  const [kw, setKw] = useState<ReturnType<typeof parseKeywords>>({ entries: [], duplicates: 0, errors: [] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onChange = useCallback((r: ReturnType<typeof parseKeywords>) => setKw(r), []);

  const close = () => {
    setOpen(false);
    setError(null);
    if (search.get("import")) {
      const params = new URLSearchParams(search.toString());
      params.delete("import");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  };
  const submit = () =>
    start(async () => {
      setError(null);
      const res = await addKeywordsAction(projectId, kw.entries);
      if (!res.ok) return setError(res.error);
      close();
      router.refresh();
    });

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add keywords
      </Button>
      <Dialog
        open={open}
        onClose={close}
        size="xl"
        title="Add keywords"
        description={`Up to ${remaining.toLocaleString()} more keyword${remaining === 1 ? "" : "s"} can be tracked in this campaign. New keywords get the campaign's history backfilled.`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={!kw.entries.length || kw.errors.length > 0} onClick={submit}>
              Add {kw.entries.length ? kw.entries.length.toLocaleString() : ""} keyword{kw.entries.length === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        {prefill.length > 0 && (
          <Callout tone="info" className="mb-3">
            {prefill.length} keyword{prefill.length === 1 ? " was" : "s were"} sent here from another tool.
          </Callout>
        )}
        {error && (
          <Callout tone="critical" className="mb-3">
            {error}
          </Callout>
        )}
        {open && <KeywordInput initial={prefill.join("\n")} suggestions={suggestions} existing={existing} max={remaining} onChange={onChange} tagNames={tagNames} />}
      </Dialog>
    </>
  );
}
