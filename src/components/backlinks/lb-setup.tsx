"use client";

import { Plus, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useMemo, useState, useTransition } from "react";
import { saveLbSetupAction } from "@/app/(app)/link-building/actions";
import { looseRootDomain } from "@/lib/backlinks/normalize";
import { cn } from "@/lib/utils";
import { DomainAvatar } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";

const MAX_KW = 10;
const MAX_COMP = 10;

export type LbSetupProps = {
  projectId: string;
  initialKeywords: string[];
  initialCompetitors: string[];
  /** Competitor options: project competitors first, then engine suggestions. */
  competitorOptions: { domain: string; note: string }[];
  keywordSuggestions: string[];
};

type FormState = { pending: boolean; error: string | null };

/** With `onStateChange` the form leaves its submit button and error out, so a Dialog footer can render them (`form={formId}`). */
export function LbSetupForm({
  projectId,
  initialKeywords,
  initialCompetitors,
  competitorOptions,
  keywordSuggestions,
  submitLabel = "Find prospects",
  onDone,
  formId,
  onStateChange,
}: LbSetupProps & { submitLabel?: string; onDone?: () => void; formId?: string; onStateChange?: (s: FormState) => void }) {
  const router = useRouter();
  const [keywords, setKeywords] = useState(initialKeywords.join("\n"));
  const [selected, setSelected] = useState<string[]>(initialCompetitors);
  const [extra, setExtra] = useState<{ domain: string; note: string }[]>(() => initialCompetitors.filter((c) => !competitorOptions.some((o) => o.domain === c)).map((d) => ({ domain: d, note: "Added by you" })));
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => onStateChange?.({ pending, error }), [pending, error, onStateChange]);
  const kwList = useMemo(
    () =>
      keywords
        .split(/\n|,/)
        .map((k) => k.trim())
        .filter(Boolean),
    [keywords],
  );
  const options = [...competitorOptions, ...extra];
  const toggle = (d: string) => setSelected((s) => (s.includes(d) ? s.filter((x) => x !== d) : s.length >= MAX_COMP ? s : [...s, d]));
  const addCustom = () => {
    const d = looseRootDomain(custom.trim());
    if (!d) return setError(`“${custom}” is not a valid domain.`);
    setError(null);
    if (!options.some((o) => o.domain === d)) setExtra((x) => [...x, { domain: d, note: "Added by you" }]);
    if (!selected.includes(d) && selected.length < MAX_COMP) setSelected((s) => [...s, d]);
    setCustom("");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!kwList.length) return setError("Add at least one target keyword.");
    if (kwList.length > MAX_KW) return setError(`Add at most ${MAX_KW} keywords (you have ${kwList.length}).`);
    start(async () => {
      const res = await saveLbSetupAction(projectId, { keywords: kwList, competitors: selected });
      if (!res.ok) return setError(res.error);
      setError(null);
      onDone?.();
      router.refresh();
    });
  };
  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {error && !onStateChange && <Callout tone="critical">{error}</Callout>}
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <Field label={`Target keywords (${kwList.length}/${MAX_KW})`} htmlFor="lb-keywords" hint="One per line. Sites ranking for these keywords become prospects." error={kwList.length > MAX_KW ? `Remove ${kwList.length - MAX_KW} keyword(s).` : undefined}>
            <Textarea id="lb-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={7} placeholder={"mba colleges in gujarat\nengineering admission"} aria-invalid={kwList.length > MAX_KW} />
          </Field>
          {keywordSuggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-text-3">Suggestions:</span>
              {keywordSuggestions
                .filter((k) => !kwList.includes(k))
                .slice(0, 8)
                .map((k) => (
                  <button key={k} type="button" disabled={kwList.length >= MAX_KW} onClick={() => setKeywords((v) => (v.trim() ? `${v.trim()}\n${k}` : k))} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] text-text-2 hover:border-brand hover:text-text disabled:opacity-40">
                    <Plus className="h-3 w-3" /> {k}
                  </button>
                ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-text-2">
            Competitors ({selected.length}/{MAX_COMP})
          </div>
          <p className="mb-2 text-[12px] text-text-3">Domains linking to them (but not to you) become prospects.</p>
          <ul className="scroll-thin max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
            {options.length === 0 && <li className="px-2 py-3 text-center text-[12.5px] text-text-3">No competitors yet — add one below.</li>}
            {options.map((o) => (
              <li key={o.domain}>
                <label className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-surface-2", selected.includes(o.domain) && "bg-brand-soft/40")}>
                  <Checkbox checked={selected.includes(o.domain)} onChange={() => toggle(o.domain)} disabled={!selected.includes(o.domain) && selected.length >= MAX_COMP} />
                  <DomainAvatar domain={o.domain} />
                  <span className="flex-1 truncate">{o.domain}</span>
                  <span className="text-[11.5px] text-text-3">{o.note}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustom())} placeholder="Add a competitor domain" aria-label="Add a competitor domain" />
            <Button type="button" onClick={addCustom} disabled={!custom.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>
      </div>
      {!onStateChange && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

export function LbSettingsButton(props: LbSetupProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ pending: false, error: null });
  const formId = useId();
  const close = () => {
    setOpen(false);
    setState({ pending: false, error: null });
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" /> Settings
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Link Building settings"
        description="Target keywords and competitors used to find prospects."
        size="xl"
        dismissible={!state.pending}
        error={state.error}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={state.pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={state.pending}>
              Save and refresh prospects
            </Button>
          </>
        }
      >
        <LbSetupForm {...props} formId={formId} onStateChange={setState} onDone={close} />
      </Dialog>
    </>
  );
}
