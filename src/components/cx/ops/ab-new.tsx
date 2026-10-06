"use client";

import { FlaskConical, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createAbTestAction } from "@/app/(app)/cx/ab-testing/actions";
import { ChannelChip } from "@/components/cx/publishing/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { AB_CONFIDENCES, AB_DEFAULT_MIN_CLICKS, AB_EXCLUDED, cleanAbInput, variantBody, variantProblems, type AbInput, type AbMode } from "@/lib/cx/ops/ab-model";
import { countChars, PUB_CHANNELS, type PubChannel } from "@/lib/cx/publishing/core";
import { cn } from "@/lib/utils";

export type AbChannelOption = { kind: PubChannel; name: string; connected: boolean; publishApi: boolean };

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function NewAbTestButton({ brandId, channels, requireApproval, origin, label = "New A/B test", variant = "primary" }: { brandId: string; channels: AbChannelOption[]; requireApproval: boolean; origin: string; label?: string; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      {open && <NewAbTestDialog brandId={brandId} channels={channels} requireApproval={requireApproval} origin={origin} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewAbTestDialog({ brandId, channels, requireApproval, origin, onClose }: { brandId: string; channels: AbChannelOption[]; requireApproval: boolean; origin: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [picked, setPicked] = useState<PubChannel[]>(() => {
    const live = channels.filter((c) => c.connected && c.publishApi && !AB_EXCLUDED[c.kind]).map((c) => c.kind);
    return live.length ? live : [];
  });
  const [linkUrl, setLinkUrl] = useState("");
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [minClicks, setMinClicks] = useState(String(AB_DEFAULT_MIN_CLICKS));
  const [confidence, setConfidence] = useState("0.95");
  const [endsAt, setEndsAt] = useState("");
  const [mode, setMode] = useState<AbMode>("publish");
  const [scheduleAt, setScheduleAt] = useState("");

  const toggle = (k: PubChannel) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const limit = useMemo(() => {
    const ls = picked.map((k) => PUB_CHANNELS.find((c) => c.kind === k)!).filter(Boolean);
    if (!ls.length) return null;
    return ls.reduce((m, c) => (c.limit < m.limit ? c : m));
  }, [picked]);
  const stand = `${origin.replace(/\/$/, "")}/l/abcdefg`;
  const count = (t: string) => (limit ? countChars(variantBody(t).replaceAll("{link}", stand), limit.kind) : [...t].length);

  const input = (): AbInput => ({
    name, hypothesis, channels: picked, linkUrl, textA, textB,
    minClicks: Number(minClicks), confidence: Number(confidence), endsAt: toIso(endsAt), mode, scheduleAt: toIso(scheduleAt),
  });
  const submit = () => {
    if (pending) return;
    const c = cleanAbInput(input(), Date.now(), origin.length);
    if (!c.ok) return setError(c.error);
    setError(null);
    start(async () => {
      const r = await createAbTestAction(brandId, input());
      if (!r.ok) return setError(r.error);
      const notice = r.data.pendingApproval ? "approval" : r.data.mode;
      router.push(`/cx/ab-testing/${r.data.id}?brand=${brandId}&notice=${notice}`);
    });
  };
  const unconnected = picked.filter((k) => !channels.find((c) => c.kind === k)?.connected);

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="New A/B test"
      description="Two variants of one post go out on the same channels at the same time; tracked-link clicks decide the winner."
      error={error}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {!pending && <FlaskConical className="h-4 w-4" />}
            {mode === "draft" ? "Create test with drafts" : requireApproval ? "Create & submit for approval" : mode === "schedule" ? "Create & schedule" : "Create & publish"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1.3fr]">
          <Field label="Test name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Autumn guide · question vs statement" maxLength={120} autoFocus />
          </Field>
          <Field label="Hypothesis" hint="Optional: what you expect and why.">
            <Input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="A question in the first line gets more clicks than a statement." maxLength={1000} />
          </Field>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-medium text-text-2">Channels</span>
            <span className="text-[12px] text-text-3">Both variants go to every selected channel.</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {channels.map((c) => {
              const excluded = AB_EXCLUDED[c.kind];
              const on = picked.includes(c.kind);
              return (
                <button
                  key={c.kind}
                  type="button"
                  disabled={!!excluded}
                  title={excluded ?? (c.connected ? `${c.name}: connected` : c.publishApi ? `${c.name}: not connected; publish manually and mark it published` : `${c.name}: no publishing API; publish manually`)}
                  onClick={() => toggle(c.kind)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                    on ? "border-brand bg-brand-soft text-text" : "border-border text-text-2 hover:bg-surface-3",
                  )}
                >
                  <ChannelChip kind={c.kind} />
                  <span>{c.name}</span>
                  <span className={cn("h-1.5 w-1.5 rounded-full", c.connected ? "bg-good" : "bg-border-strong")} aria-hidden />
                  <span className="sr-only">{c.connected ? "connected" : "not connected"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[12px] text-text-3">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-good align-middle" /> connected ·{" "}
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-border-strong align-middle" /> not connected (the post is created and marked “not connected”; publish it manually and mark it published in Publishing; clicks on its tracked link still count).
          </p>
          {unconnected.length > 0 && picked.length > 0 && unconnected.length === picked.length && (
            <p className="mt-1 text-[12px] text-warning-ink">None of the selected channels is connected: you will publish both variants by hand.</p>
          )}
        </div>

        <Field label="Destination link" hint="Required. Each variant gets its own tracked short link per channel (UTM content variant-a / variant-b); real clicks on them decide the winner.">
          <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com/landing-page" inputMode="url" />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          {([["A", textA, setTextA], ["B", textB, setTextB]] as const).map(([v, t, set]) => {
            const n = count(t);
            const problems = t.trim() && picked.length ? variantProblems(t, picked, origin.length) : [];
            return (
              <Field
                key={v}
                label={
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white", v === "A" ? "bg-[var(--series-1)]" : "bg-[var(--series-2)]")}>{v}</span>
                      Variant {v}
                    </span>
                    <span className={cn("tabular text-[12px] font-normal", limit && n > limit.limit ? "text-critical-ink" : "text-text-3")}>
                      {n.toLocaleString("en-US")}
                      {limit ? ` / ${limit.limit.toLocaleString("en-US")} (${limit.name})` : ""}
                    </span>
                  </span>
                }
                error={problems[0]}
              >
                <Textarea value={t} onChange={(e) => set(e.target.value)} rows={5} placeholder={v === "A" ? "Our autumn guide is live. Read it here: {link}" : "Planning your autumn? 7 ideas in our new guide → {link}"} />
              </Field>
            );
          })}
        </div>
        <p className="-mt-2 text-[12px] text-text-3">
          Write <code className="rounded bg-surface-3 px-1">{"{link}"}</code> where the tracked link goes; it is added at the end when missing. Keep everything else equal except the one thing you are testing.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Min clicks per variant" hint="Before a winner can be called.">
            <Input type="number" min={5} max={100000} value={minClicks} onChange={(e) => setMinClicks(e.target.value)} />
          </Field>
          <Field label="Confidence" hint="Two-sided z-test of the click split.">
            <Select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              {AB_CONFIDENCES.map((c) => (
                <option key={c.value} value={String(c.value)}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="End date (optional)" hint="Clicks after it are not counted.">
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12.5px] font-medium text-text-2">When</span>
            <Segmented<AbMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "publish", label: "Publish now" },
                { value: "schedule", label: "Schedule" },
                { value: "draft", label: "Save as drafts" },
              ]}
            />
            {mode === "schedule" && <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="w-auto min-w-0 max-w-full" aria-label="Publish both variants at" />}
          </div>
          <p className="mt-2 text-[12px] text-text-3">
            {mode === "draft"
              ? "Both posts are saved as drafts in Publishing; start the test from its page when you are ready."
              : "Both variants are published at the same time so they get equal exposure."}
          </p>
          {requireApproval && mode !== "draft" && (
            <Callout tone="warning" className="mt-2">
              This brand requires approval: both variants will be <b>submitted for approval</b> instead. {mode === "schedule" ? "Once approved they go out at the scheduled time." : "Once both are approved, start the test from its page."}
            </Callout>
          )}
        </div>
      </div>
    </Dialog>
  );
}
