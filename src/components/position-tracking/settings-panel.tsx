"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCampaignAction, setScheduleAction, switchToLiveAction, updateCampaignAction } from "@/app/(app)/position-tracking/actions";
import { DATABASES, tryRootDomain } from "@/lib/domain";
import { dateTimeLabel } from "@/lib/format";
import { MAX_COMPETITORS, type DeviceMode } from "@/lib/position-tracking/types";
import { DomainAvatar } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";

type CampaignProps = { db: string; location: string; device: DeviceMode; competitors: string[]; source: "demo" | "dataforseo" };

export function CampaignSettings({ projectId, domain, campaign }: { projectId: string; domain: string; campaign: CampaignProps }) {
  const router = useRouter();
  const [db, setDb] = useState(campaign.db);
  const [location, setLocation] = useState(campaign.location);
  const [device, setDevice] = useState<DeviceMode>(campaign.device);
  const [competitors, setCompetitors] = useState(campaign.competitors);
  const [add, setAdd] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const targetingChanged = db !== campaign.db || location.trim() !== campaign.location;
  const dirty = targetingChanged || device !== campaign.device || competitors.join("|") !== campaign.competitors.join("|");

  const addCompetitor = () => {
    const next = [...competitors];
    for (const part of add.split(/[\s,]+/).filter(Boolean)) {
      const d = tryRootDomain(part);
      if (!d) return setAddError(`“${part}” is not a valid domain.`);
      if (d === domain) return setAddError("That is your own domain.");
      if (!next.includes(d)) next.push(d);
    }
    if (next.length > MAX_COMPETITORS) return setAddError(`Track at most ${MAX_COMPETITORS} competitors.`);
    setCompetitors(next);
    setAdd("");
    setAddError(null);
  };

  const save = () => {
    if (targetingChanged && !confirm("Changing the regional database or location starts a new ranking history. Existing history for this campaign will be deleted. Continue?")) return;
    start(async () => {
      setMsg(null);
      const res = await updateCampaignAction(projectId, { db, location, device, competitors });
      if (!res.ok) return setMsg({ tone: "critical", text: res.error });
      setMsg({ tone: "good", text: res.data.jobId ? (res.data.reset ? "Saved. History was reset and a new check is running." : "Saved. Rankings are being recalculated.") : "Saved." });
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader title="Campaign" description="Where and how rankings are tracked" />
      <CardBody className="space-y-4">
        {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Search engine" htmlFor="s-engine">
            <Select id="s-engine" value="google" disabled>
              <option value="google">Google</option>
            </Select>
          </Field>
          <Field label="Regional database" htmlFor="s-db">
            <Select id="s-db" value={db} onChange={(e) => setDb(e.target.value)}>
              {DATABASES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.flag} {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location (optional)" htmlFor="s-location" error={location.length > 120 ? "Use at most 120 characters." : undefined}>
            <Input id="s-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Country-level" />
          </Field>
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text-2">Device</div>
            <Segmented
              size="md"
              options={[
                { value: "desktop", label: "Desktop" },
                { value: "mobile", label: "Mobile" },
                { value: "both", label: "Both" },
              ]}
              value={device}
              onChange={(v) => setDevice(v as DeviceMode)}
            />
          </div>
        </div>
        {targetingChanged && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-warning-ink">
            <AlertTriangle className="h-3.5 w-3.5" /> Saving resets the ranking history (a different market is a different dataset).
          </p>
        )}
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-text-2">
            Competitors <span className="font-normal text-text-3">({competitors.length}/{MAX_COMPETITORS})</span>
          </div>
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {competitors.length === 0 && <li className="text-[12.5px] text-text-3">No competitors tracked.</li>}
            {competitors.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-1.5 text-[12.5px]">
                <DomainAvatar domain={c} size={16} /> {c}
                <button type="button" onClick={() => setCompetitors(competitors.filter((x) => x !== c))} className="rounded-full p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Remove ${c}`}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex max-w-md gap-2">
            <Input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCompetitor())} placeholder="competitor.com" aria-label="Add competitor" disabled={competitors.length >= MAX_COMPETITORS} />
            <Button type="button" onClick={addCompetitor} disabled={!add.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          {addError && <p className="mt-1 text-[12px] text-critical-ink">{addError}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" disabled={!dirty || pending} onClick={() => (setDb(campaign.db), setLocation(campaign.location), setDevice(campaign.device), setCompetitors(campaign.competitors), setMsg(null))}>
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty || location.length > 120} loading={pending} onClick={save}>
            Save changes
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function ScheduleSettings({ projectId, schedule }: { projectId: string; schedule: { cadence: string; enabled: boolean; nextRunAt: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const value = !schedule || !schedule.enabled ? "off" : schedule.cadence === "weekly" ? "weekly" : "daily";
  return (
    <Card>
      <CardHeader title="Automatic updates" description="When rankings are re-checked" />
      <CardBody className="space-y-2">
        <Segmented
          size="md"
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "off", label: "Off" },
          ]}
          value={value}
          onChange={(v) =>
            start(async () => {
              setError(null);
              const res = await setScheduleAction(projectId, v as "daily" | "weekly" | "off");
              if (!res.ok) setError(res.error);
              router.refresh();
            })
          }
        />
        <p className="text-[12.5px] text-text-3">{pending ? "Saving…" : value === "off" ? "Rankings only update when you click “Update now”." : schedule ? `Next check ${dateTimeLabel(schedule.nextRunAt)}.` : ""}</p>
        {error && <p className="text-[12px] text-critical-ink">{error}</p>}
      </CardBody>
    </Card>
  );
}

export function DataSourceSettings({ projectId, source, live }: { projectId: string; source: "demo" | "dataforseo"; live: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Data source" />
      <CardBody className="space-y-2 text-[13px] text-text-2">
        {source === "dataforseo" ? (
          <p>Live Google SERPs (top 100) from DataForSEO, one request per keyword and device per check. Search volume and CPC come from Google Ads data.</p>
        ) : live ? (
          <>
            <p>This campaign uses demo data, but DataForSEO is now connected. Switching clears the demo history and starts live tracking from today.</p>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                confirm("Switch to live DataForSEO data? Demo history will be deleted and each check will use paid API requests.") &&
                start(async () => {
                  const res = await switchToLiveAction(projectId);
                  if (!res.ok) setError(res.error);
                  router.refresh();
                })
              }
            >
              Switch to live data
            </Button>
          </>
        ) : (
          <p>
            Demo data from SynapseSEO&apos;s deterministic engine. <a href="/settings" className="text-link hover:underline">Connect DataForSEO</a> to track live Google rankings.
          </p>
        )}
        {error && <p className="text-[12px] text-critical-ink">{error}</p>}
      </CardBody>
    </Card>
  );
}

export function DangerZone({ projectId, domain }: { projectId: string; domain: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="border-critical/30">
      <CardHeader title="Delete campaign" description="Removes all keywords, tags, ranking history and alert rules of this campaign. The project stays." />
      <CardBody>
        <Button
          variant="danger"
          loading={pending}
          onClick={() =>
            prompt(`Type ${domain} to delete the Position Tracking campaign.`) === domain &&
            start(async () => {
              const res = await deleteCampaignAction(projectId);
              if (!res.ok) return setError(res.error);
              router.replace(`/position-tracking?project=${projectId}`);
              router.refresh();
            })
          }
        >
          Delete campaign
        </Button>
        {error && <p className="mt-2 text-[12px] text-critical-ink">{error}</p>}
      </CardBody>
    </Card>
  );
}
