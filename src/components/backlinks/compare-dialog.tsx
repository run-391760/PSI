"use client";

import { GitCompareArrows, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { looseRootDomain } from "@/lib/backlinks/normalize";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";

/** Opens a dialog to compare up to 5 domains' backlink profiles (navigates to ?q=a,b,c). */
export function CompareButton({ initial, label = "Compare domains", variant = "secondary" }: { initial: string[]; label?: string; variant?: "secondary" | "primary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<string[]>(() => {
    const v = initial.slice(0, 5);
    while (v.length < 2) v.push("");
    return v;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const entered = values.map((v) => v.trim()).filter(Boolean);
    const invalid = entered.filter((v) => !looseRootDomain(v));
    if (invalid.length) return setError(`Not a valid domain: ${invalid.join(", ")}`);
    const domains = [...new Set(entered.map((v) => looseRootDomain(v)!))];
    if (domains.length < 2) return setError("Enter at least two different domains.");
    setError(null);
    start(() => {
      router.push(`/backlink-analytics?q=${encodeURIComponent(domains.join(","))}`);
      setOpen(false);
    });
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <GitCompareArrows className="h-4 w-4" /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Compare backlink profiles"
        description="Up to 5 domains side by side: authority, referring domains, backlinks and link velocity."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="bl-compare-form" loading={pending}>
              Compare
            </Button>
          </>
        }
      >
        <form id="bl-compare-form" onSubmit={submit} className="space-y-2.5">
          {error && <Callout tone="critical">{error}</Callout>}
          {values.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(--series-${i + 1})` }} aria-hidden />
              <Input value={v} onChange={(e) => setValues((all) => all.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? "your-domain.com" : `competitor${i}.com`} aria-label={`Domain ${i + 1}`} />
              {values.length > 2 && (
                <button type="button" onClick={() => setValues((all) => all.filter((_, j) => j !== i))} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Remove domain">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {values.length < 5 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setValues((all) => [...all, ""])}>
              <Plus className="h-3.5 w-3.5" /> Add domain
            </Button>
          )}
        </form>
      </Dialog>
    </>
  );
}
