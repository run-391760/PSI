"use client";

import { Check, ChevronLeft, ChevronRight, Monitor, MonitorSmartphone, Plus, Smartphone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { keywordSuggestionsAction, setupCampaignAction } from "@/app/(app)/position-tracking/actions";
import { DATABASES, tryRootDomain } from "@/lib/domain";
import { BACKFILL_DAYS, MAX_COMPETITORS, MAX_KEYWORDS, SOURCE_INFO, type CampaignSource, type DeviceMode } from "@/lib/position-tracking/types";
import { cn } from "@/lib/utils";
import { DomainAvatar } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { KeywordInput, type Suggestion, type parseKeywords } from "./keyword-input";

const STEPS = ["Targeting", "Competitors", "Keywords"] as const;
const DEVICES: { id: DeviceMode; label: string; icon: typeof Monitor; note: string }[] = [
  { id: "desktop", label: "Desktop", icon: Monitor, note: "Google desktop results" },
  { id: "mobile", label: "Mobile", icon: Smartphone, note: "Google mobile results" },
  { id: "both", label: "Desktop & mobile", icon: MonitorSmartphone, note: "Track both, compare devices" },
];

export function SetupWizard({
  project,
  projectCompetitors,
  suggestedCompetitors,
  suggestions: initialSuggestions,
  prefill,
  sources,
}: {
  project: { id: string; name: string; domain: string; country: string; device: "desktop" | "mobile"; location: string };
  projectCompetitors: string[];
  suggestedCompetitors: string[];
  suggestions: Suggestion[];
  prefill: string[];
  /** Available data sources, best first. */
  sources: CampaignSource[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<CampaignSource>(sources[0]);
  const live = source === "dataforseo";
  const gsc = source === "search-console";
  const [db, setDb] = useState(project.country);
  const [location, setLocation] = useState(project.location);
  const [device, setDevice] = useState<DeviceMode>(project.device);
  const [competitors, setCompetitors] = useState<string[]>(projectCompetitors.slice(0, MAX_COMPETITORS));
  const [extra, setExtra] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [kw, setKw] = useState<ReturnType<typeof parseKeywords>>({ entries: [], duplicates: 0, errors: [] });
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onKeywords = useCallback((r: ReturnType<typeof parseKeywords>) => setKw(r), []);

  // Suggestions follow the selected regional database.
  useEffect(() => {
    if (db === project.country) return setSuggestions(initialSuggestions);
    let alive = true;
    keywordSuggestionsAction(project.id, db).then((r) => alive && r.ok && setSuggestions(r.data));
    return () => {
      alive = false;
    };
  }, [db, project.id, project.country, initialSuggestions]);

  const addExtra = () => {
    const parts = extra.split(/[\s,]+/).filter(Boolean);
    const next = [...competitors];
    for (const p of parts) {
      const d = tryRootDomain(p);
      if (!d) return setExtraError(`“${p}” is not a valid domain.`);
      if (d === project.domain) return setExtraError("That is your own domain.");
      if (!next.includes(d)) next.push(d);
    }
    if (next.length > MAX_COMPETITORS) return setExtraError(`Track at most ${MAX_COMPETITORS} competitors.`);
    setCompetitors(next);
    setExtra("");
    setExtraError(null);
  };
  const toggle = (d: string) => {
    if (competitors.includes(d)) setCompetitors(competitors.filter((c) => c !== d));
    else if (competitors.length < MAX_COMPETITORS) setCompetitors([...competitors, d]);
  };
  const candidates = [...new Set([...projectCompetitors, ...suggestedCompetitors, ...competitors])].filter((d) => d !== project.domain);

  const canNext = step === 0 ? Boolean(db) && location.length <= 120 : step === 1 ? competitors.length <= MAX_COMPETITORS : kw.entries.length > 0 && kw.errors.length === 0;
  const submit = () =>
    start(async () => {
      setError(null);
      const res = await setupCampaignAction(project.id, { db, location, device, competitors, keywords: kw.entries, source });
      if (!res.ok) return setError(res.error);
      router.replace(`/position-tracking?project=${project.id}`);
      router.refresh();
    });

  return (
    <Card>
      <ol className="flex border-b border-border" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn("flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium", i === step ? "text-text" : i < step ? "text-text-2 hover:text-text" : "text-text-3", i === step && "shadow-[inset_0_-2px_0_var(--brand)]")}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={cn("flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold", i < step ? "bg-good text-white" : i === step ? "bg-brand text-white" : "bg-surface-3 text-text-3")}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="truncate">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="p-4 sm:p-5">
        {step === 0 && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="Data source" htmlFor="pt-source" hint={gsc ? "Average positions, clicks and impressions of your own site from its linked Search Console property." : live ? "Live Google SERPs incl. competitors and SERP features." : "Synthetic data (local development)."}>
                <Select id="pt-source" value={source} onChange={(e) => setSource(e.target.value as CampaignSource)} disabled={sources.length < 2}>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      Google · {SOURCE_INFO[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Regional database" htmlFor="pt-db" hint={gsc ? "Only searches from this country are counted." : "Google market whose results are tracked."}>
                <Select id="pt-db" value={db} onChange={(e) => setDb(e.target.value)}>
                  {DATABASES.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.flag} {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location (optional)" htmlFor="pt-location" hint={live ? "City or region, e.g. “Austin,Texas”. Leave empty for country-level results." : gsc ? "Search Console reports country-level data; this is only a label." : "City or region label for this campaign. Leave empty for country-level results."} error={location.length > 120 ? "Use at most 120 characters." : undefined}>
                <Input id="pt-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Vadodara, Gujarat" />
              </Field>
            </div>
            <div>
              <div className="mb-1 text-[12.5px] font-medium text-text-2">Device</div>
              <div className="grid gap-2" role="radiogroup" aria-label="Device">
                {DEVICES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={device === d.id}
                    onClick={() => setDevice(d.id)}
                    className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors", device === d.id ? "border-brand bg-brand-soft/60" : "border-border hover:bg-surface-2")}
                  >
                    <d.icon className={cn("h-5 w-5", device === d.id ? "text-brand" : "text-text-3")} />
                    <span className="flex-1">
                      <span className="block text-[13px] font-medium text-text">{d.label}</span>
                      <span className="block text-[12px] text-text-3">{d.note}</span>
                    </span>
                    {device === d.id && <Check className="h-4 w-4 text-brand" />}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-text-3">
                {gsc
                  ? "Positions come from your Search Console property: the daily average position of your site for each exact keyword and device. 90 days of history are backfilled; Search Console data lags 2–3 days."
                  : live
                    ? "Rankings come from live Google SERPs via DataForSEO (top 100). Each keyword and device is one paid SERP request per check."
                    : `Demo mode: rankings are generated by the demo engine and ${BACKFILL_DAYS} days of history are backfilled so reports are populated immediately.`}
              </p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {gsc && (
              <Callout tone="info">Search Console only reports your own site, so competitor positions are not collected. Competitors you add are kept and tracked once you switch the campaign to DataForSEO.</Callout>
            )}
            <p className="text-[13px] text-text-2">
              Pick up to {MAX_COMPETITORS} competitors to compare visibility, positions and share of voice. <span className="text-text-3">{competitors.length} selected.</span>
            </p>
            {candidates.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {candidates.map((d) => {
                  const on = competitors.includes(d);
                  const tag = projectCompetitors.includes(d) ? "Project competitor" : suggestedCompetitors.includes(d) ? "Suggested" : "Added";
                  return (
                    <li key={d}>
                      <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2", on ? "border-brand bg-brand-soft/50" : "border-border hover:bg-surface-2", !on && competitors.length >= MAX_COMPETITORS && "cursor-not-allowed opacity-50")}>
                        <Checkbox checked={on} onChange={() => toggle(d)} disabled={!on && competitors.length >= MAX_COMPETITORS} />
                        <DomainAvatar domain={d} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text">{d}</span>
                        <span className="text-[11px] text-text-3">{tag}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-text-3">No competitors yet — add domains below, or skip this step.</p>
            )}
            <div className="max-w-xl">
              <Field label="Add competitor domains" htmlFor="pt-extra" error={extraError ?? undefined} hint="Separate several domains with commas or spaces.">
                <div className="flex gap-2">
                  <Input id="pt-extra" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtra())} placeholder="competitor.com" />
                  <Button type="button" onClick={addExtra} disabled={!extra.trim()}>
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
              </Field>
            </div>
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {competitors.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pr-1.5 pl-2 text-[12px] text-text">
                    {c}
                    <button type="button" onClick={() => toggle(c)} className="rounded-full p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Remove ${c}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {prefill.length > 0 && <Callout tone="info">{prefill.length} keyword{prefill.length === 1 ? " was" : "s were"} sent here from another tool. Review them and start tracking.</Callout>}
            <KeywordInput initial={prefill.join("\n")} suggestions={suggestions} max={MAX_KEYWORDS} onChange={onKeywords} />
          </div>
        )}

        {error && (
          <Callout tone="critical" className="mt-4">
            {error}
          </Callout>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
        <span className="text-[12px] text-text-3">
          {project.domain} · {DATABASES.find((d) => d.code === db)?.flag} {db}
          {location ? ` · ${location}` : ""} · {DEVICES.find((d) => d.id === device)?.label}
          {competitors.length ? ` · ${competitors.length} competitor${competitors.length === 1 ? "" : "s"}` : ""}
        </span>
        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button type="button" variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="primary" disabled={!canNext} loading={pending} onClick={submit}>
              Start tracking {kw.entries.length ? `${kw.entries.length} keyword${kw.entries.length === 1 ? "" : "s"}` : ""}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
