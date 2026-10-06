"use client";

import { Play, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState, useTransition } from "react";
import { saveAuditSettings, startAudit } from "@/app/(app)/site-audit/actions";
import type { AuditConfig } from "@/lib/site-audit/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";

const SOURCES: { value: AuditConfig["source"]; label: string; hint: string }[] = [
  { value: "website", label: "Website", hint: "Follow links from the start URL (breadth-first)." },
  { value: "sitemap", label: "Sitemap", hint: "Crawl only URLs listed in the XML sitemap." },
  { value: "both", label: "Website + sitemap", hint: "Follow links, then add sitemap-only URLs." },
];
const DELAYS = [
  { value: 500, label: "0.5 s — fast" },
  { value: 1000, label: "1 s — default" },
  { value: 2000, label: "2 s — gentle" },
  { value: 5000, label: "5 s — very gentle" },
  { value: 10000, label: "10 s — minimal load" },
];

type FormState = { pending: boolean; action: "save" | "start" | null; error: string | null };

/**
 * Site Audit settings (page limit, source, user agent, masks, delay, schedule). With `onStateChange`
 * the form leaves its buttons and error out for a Dialog footer: submit buttons with `form={formId}`,
 * value="save" saves only, any other submit saves and re-crawls.
 */
export function AuditSettingsForm({
  projectId,
  domain,
  initial,
  mode,
  onDone,
  formId,
  onStateChange,
}: {
  projectId: string;
  domain: string;
  initial: AuditConfig;
  mode: "setup" | "dialog";
  onDone?: () => void;
  formId?: string;
  onStateChange?: (s: FormState) => void;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<AuditConfig>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"save" | "start" | null>(null);
  useEffect(() => onStateChange?.({ pending, action, error }), [pending, action, error, onStateChange]);
  const set = <K extends keyof AuditConfig>(k: K, v: AuditConfig[K]) => {
    setSaved(false);
    setCfg((c) => ({ ...c, [k]: v }));
  };
  const lines = (s: string) =>
    s
      .split(/\n/)
      .map((x) => x.trim())
      .filter(Boolean);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const kind = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "save" ? "save" : "start";
    setError(null);
    setAction(kind);
    start(async () => {
      const input = { ...cfg, limit: Number(cfg.limit) };
      const res = kind === "start" ? await startAudit(projectId, input) : await saveAuditSettings(projectId, input);
      if (!res.ok) return setError(res.error);
      if (kind === "save") setSaved(true);
      onDone?.();
      router.refresh();
    });
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-4">
      {/* Default button first in tree order, so Enter saves and crawls rather than hitting "Save settings". */}
      <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
      {error && !onStateChange && <Callout tone="critical">{error}</Callout>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start URL" htmlFor="sa-start" hint={`Must be on ${domain}. Redirects are followed.`}>
          <Input id="sa-start" value={cfg.startUrl} onChange={(e) => set("startUrl", e.target.value)} placeholder={`https://${domain}/`} />
        </Field>
        <Field label="Page limit" htmlFor="sa-limit" hint="10–500 pages per crawl.">
          <div className="flex flex-wrap items-center gap-2">
            <Input id="sa-limit" type="number" min={10} max={500} step={10} value={cfg.limit} onChange={(e) => set("limit", Number(e.target.value))} className="w-24" />
            <Segmented
              options={[50, 100, 250, 500].map((n) => ({ value: String(n), label: String(n) }))}
              value={String(cfg.limit)}
              onChange={(v) => set("limit", Number(v))}
            />
          </div>
        </Field>
      </div>

      <div>
        <div className="mb-1 text-[12.5px] font-medium text-text-2">Crawl source</div>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Crawl source">
          {SOURCES.map((s) => (
            <button
              type="button"
              key={s.value}
              role="radio"
              aria-checked={cfg.source === s.value}
              onClick={() => set("source", s.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-left transition-colors",
                cfg.source === s.value ? "border-brand bg-brand-soft/60" : "border-border-strong hover:bg-surface-2",
              )}
            >
              <div className={cn("text-[13px] font-medium", cfg.source === s.value ? "text-brand-ink" : "text-text")}>{s.label}</div>
              <div className="mt-0.5 text-[12px] text-text-3">{s.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="User agent" hint="Always identifies as SynapseSEOBot/1.0.">
          <Segmented
            size="md"
            options={[
              { value: "desktop", label: "Desktop" },
              { value: "mobile", label: "Mobile" },
            ]}
            value={cfg.device}
            onChange={(v) => set("device", v)}
          />
        </Field>
        <Field label="Crawl delay per host" htmlFor="sa-delay" hint="robots.txt Crawl-delay wins if larger.">
          <Select id="sa-delay" value={cfg.delayMs} onChange={(e) => set("delayMs", Number(e.target.value))}>
            {DELAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Re-crawl schedule" htmlFor="sa-schedule" hint="Recurring crawls notify you of changes.">
          <Select id="sa-schedule" value={cfg.schedule} onChange={(e) => set("schedule", e.target.value as AuditConfig["schedule"])}>
            <option value="off">Off (manual only)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Allow only URLs matching" htmlFor="sa-allow" hint="One mask per line, e.g. /blog/ or /docs/*.html. Empty = everything.">
          <Textarea id="sa-allow" rows={3} className="min-h-0 font-mono text-[12.5px]" value={cfg.allow.join("\n")} onChange={(e) => set("allow", lines(e.target.value))} placeholder="/blog/" />
        </Field>
        <Field label="Never crawl URLs matching" htmlFor="sa-disallow" hint="e.g. /cart, *?sort=*, /tag/. The start URL is always crawled.">
          <Textarea id="sa-disallow" rows={3} className="min-h-0 font-mono text-[12.5px]" value={cfg.disallow.join("\n")} onChange={(e) => set("disallow", lines(e.target.value))} placeholder={"/cart\n*?sort=*"} />
        </Field>
      </div>

      <div className="flex flex-col gap-2 text-[13px] text-text-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
        <label className="inline-flex items-center gap-2">
          <Checkbox checked={cfg.subdomains} onChange={(e) => set("subdomains", e.target.checked)} />
          Include all subdomains of {domain}
        </label>
        <label className="inline-flex items-center gap-2">
          <Checkbox checked={cfg.checkExternal} onChange={(e) => set("checkExternal", e.target.checked)} />
          Check external links (up to 100)
        </label>
        <label className="inline-flex items-center gap-2 text-text-3" title="SynapseSEOBot always obeys robots.txt, including Crawl-delay.">
          <Checkbox checked disabled readOnly />
          Respect robots.txt (always on)
        </label>
      </div>

      {!onStateChange && (
        <div className={cn("flex flex-wrap items-center gap-2 pt-1", mode === "dialog" ? "justify-end border-t border-border pt-4" : "")}>
          {saved && <span className="mr-auto text-[12.5px] text-good-ink">Settings saved.</span>}
          {mode === "dialog" && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" value="save" loading={pending && action === "save"} disabled={pending}>
            Save settings
          </Button>
          <Button type="submit" variant="primary" loading={pending && action === "start"} disabled={pending}>
            <Play className="h-3.5 w-3.5" /> {mode === "setup" ? "Start Site Audit" : "Save & re-crawl"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function AuditSettingsButton(props: { projectId: string; domain: string; initial: AuditConfig; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ pending: false, action: null, error: null });
  const formId = useId();
  const close = () => {
    setOpen(false);
    setState({ pending: false, action: null, error: null });
  };
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={props.disabled}>
        <Settings2 className="h-4 w-4" /> Settings
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Site Audit settings"
        description={`Crawl configuration for ${props.domain}`}
        size="xl"
        dismissible={!state.pending}
        error={state.error}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={state.pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} value="save" loading={state.pending && state.action === "save"} disabled={state.pending}>
              Save settings
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={state.pending && state.action === "start"} disabled={state.pending}>
              <Play className="h-3.5 w-3.5" /> Save &amp; re-crawl
            </Button>
          </>
        }
      >
        <AuditSettingsForm {...props} mode="dialog" onDone={close} formId={formId} onStateChange={setState} />
      </Dialog>
    </>
  );
}
