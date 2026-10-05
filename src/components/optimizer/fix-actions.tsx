"use client";

import { Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { aiProposeAction, applyFixAction } from "@/app/(app)/optimizer/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/feedback";
import type { Fix, FixOption } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { flashScore } from "./score-flash";

/** What a fix will change, for the approval preview. */
export function describeFix(fix: Fix): { kind: string; text: string }[] {
  switch (fix.kind) {
    case "set":
      return [{ kind: `Set ${fix.field === "metaDescription" ? "meta description" : fix.field}`, text: fix.value }];
    case "meta":
      return Object.entries(fix.patch).map(([k, v]) => ({ kind: `Set ${k}`, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }));
    case "replace":
      return [{ kind: fix.replace ? "Replace" : "Remove", text: fix.replace ? `${fix.find}\n\n→\n\n${fix.replace}` : fix.find }];
    case "insert":
      return [{ kind: `Insert (${typeof fix.position === "string" ? fix.position.replace(/-/g, " ") : `under “${fix.position.afterHeading}”`})`, text: fix.markdown }];
    case "set-h1":
      return [{ kind: "Set H1", text: fix.text }];
    case "link":
      return [{ kind: "Add link", text: `“${fix.phrase}” → ${fix.url}` }];
    case "alt":
      return [{ kind: "Set alt text", text: `${fix.src}\n→ ${fix.alt}` }];
    case "batch":
      return fix.fixes.flatMap(describeFix);
  }
}

export async function runFix(draftId: string, fix: Fix, label: string) {
  const r = await applyFixAction(draftId, fix, label);
  if (r.ok) flashScore({ title: `Applied: ${label}`, before: r.data.before, after: r.data.after, status: r.data.status, detail: r.data.notes.join("\n") || undefined });
  else flashScore({ title: "Could not apply the fix", detail: r.error, error: true });
  return r.ok;
}

function Preview({ fix }: { fix: Fix }) {
  const parts = describeFix(fix);
  return (
    <div className="space-y-3">
      {parts.slice(0, 20).map((p, i) => (
        <div key={i}>
          <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">{p.kind}</div>
          <pre className="scroll-thin max-h-72 overflow-auto rounded-md border border-border bg-surface-2 p-2.5 text-[12.5px] whitespace-pre-wrap text-text">{p.text}</pre>
        </div>
      ))}
      {parts.length > 20 && <div className="text-[12.5px] text-text-3">…and {parts.length - 20} more changes</div>}
    </div>
  );
}

/** Fix buttons for one finding: deterministic fixes preview then apply; AI fixes ask Claude first, then preview. */
export function FixActions({ draftId, feature, fixes, aiOn, className }: { draftId: string; feature: string; fixes: FixOption[]; aiOn: boolean; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ title: string; note?: string; options: FixOption[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (o: FixOption) => {
    if (!o.fix) return;
    setBusy(o.id);
    const ok = await runFix(draftId, o.fix, o.label);
    setBusy(null);
    if (ok) {
      setOpen(null);
      router.refresh();
    }
  };
  const propose = async (o: FixOption) => {
    setBusy(o.id);
    setError(null);
    const r = await aiProposeAction(draftId, feature, o.id);
    setBusy(null);
    if (r.ok) setOpen({ title: o.label, note: `${r.data.note} (written by ${r.data.model}; review before applying)`, options: r.data.options });
    else setError(r.error);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {fixes.map((o) =>
        o.ai ? (
          <Button key={o.id} size="sm" variant="secondary" disabled={!aiOn || !!busy} title={aiOn ? o.description : "Add ANTHROPIC_API_KEY on the server to use Claude"} onClick={() => propose(o)}>
            {busy === o.id ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5 text-brand-ink" />}
            {o.label}
          </Button>
        ) : (
          <Button key={o.id} size="sm" variant="secondary" disabled={!!busy} title={o.description} onClick={() => setOpen({ title: o.label, note: o.description, options: [o] })}>
            <Wand2 className="h-3.5 w-3.5 text-brand-ink" />
            {o.label}
          </Button>
        ),
      )}
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.title ?? ""}
        description={open?.note}
        size="lg"
        footer={
          open && open.options.length === 1 ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!!busy} onClick={() => apply(open.options[0])}>
                {busy ? <Spinner className="h-3.5 w-3.5 border-white border-r-transparent" /> : null}
                Apply &amp; re-score
              </Button>
            </>
          ) : undefined
        }
      >
        {open && open.options.length === 1 && open.options[0].fix && <Preview fix={open.options[0].fix} />}
        {open && open.options.length > 1 && (
          <ul className="divide-y divide-border">
            {open.options.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13.5px] text-text">{o.label}</div>
                  <div className="text-[12px] text-text-3">{o.description}</div>
                </div>
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => apply(o)}>
                  {busy === o.id ? <Spinner className="h-3.5 w-3.5 border-white border-r-transparent" /> : null}
                  Apply
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
