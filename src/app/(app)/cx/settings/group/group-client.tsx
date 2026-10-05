"use client";

import { ImageUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { GroupDetails } from "@/lib/cx/admin/group";
import { LANGUAGE_NAMES } from "@/lib/cx/listening/sources";
import { COUNTRIES } from "@/lib/cx/listening/topic-query";
import { KAvatar, KDate, KSection } from "../_admin/k-ui";
import { Field, useRun } from "../_admin/ui";
import { saveGroupDetailsAction } from "./actions";

/** Group Details form: identity (owner only), logo, timezone, language, description and links to hours and plan. */
export function GroupClient({ brand, g, isOwner, canEdit, zones: ZONES }: { brand: string; g: GroupDetails; isOwner: boolean; canEdit: boolean; zones: string[] }) {
  const { run, busy, messages } = useRun();
  const [f, setF] = useState({ name: g.name, domain: g.domain, country: g.country, language: g.language, timezone: g.timezone, logo: g.logo, description: g.description, industry: g.industry, supportEmail: g.supportEmail });
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const zones = ZONES.includes(f.timezone) || !f.timezone ? ZONES : [f.timezone, ...ZONES];
  const identityLocked = !isOwner || !canEdit;
  const onFile = (file: File | undefined) => {
    setLogoErr(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setLogoErr("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > 150_000) return setLogoErr("The image is larger than 150 KB. Resize it or paste an https URL instead.");
    const r = new FileReader();
    r.onload = () => set("logo", String(r.result));
    r.readAsDataURL(file);
  };
  return (
    <div className="space-y-4">
      {messages}
      <KSection title="Group details">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
          <div className="flex flex-col items-center gap-3 text-center">
            <KAvatar name={f.name} src={f.logo || null} className="h-24 w-24 text-[26px]" />
            {canEdit && (
              <div className="flex flex-wrap justify-center gap-2">
                <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[12.5px] font-medium text-text shadow-card hover:bg-surface-3">
                  <ImageUp className="h-3.5 w-3.5" />Upload logo
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {f.logo && <Button size="sm" variant="ghost" onClick={() => set("logo", "")}><Trash2 className="h-3.5 w-3.5" />Remove</Button>}
              </div>
            )}
            {logoErr && <p className="text-[12px] text-critical-ink">{logoErr}</p>}
            {canEdit && <Input aria-label="Logo URL" placeholder="or https://… image URL" value={f.logo.startsWith("data:") ? "" : f.logo} onChange={(e) => set("logo", e.target.value)} className="text-[12px]" />}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Brand name" hint={!isOwner ? "Only the brand owner can change this." : undefined}><Input value={f.name} disabled={identityLocked} onChange={(e) => set("name", e.target.value)} maxLength={80} /></Field>
            <Field label="Domain"><Input value={f.domain} disabled={identityLocked} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" /></Field>
            <Field label="Country"><Select value={f.country} disabled={identityLocked} onChange={(e) => set("country", e.target.value)}>{!COUNTRIES[f.country] && <option value={f.country}>{f.country}</option>}{Object.entries(COUNTRIES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
            <Field label="Language"><Select value={f.language} disabled={identityLocked} onChange={(e) => set("language", e.target.value)}>{!LANGUAGE_NAMES[f.language] && <option value={f.language}>{f.language}</option>}{Object.entries(LANGUAGE_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select></Field>
            <Field label="Timezone" hint="Used for business hours, SLAs and report days.">
              {zones.length ? <Select value={f.timezone} disabled={!canEdit} onChange={(e) => set("timezone", e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select> : <Input value={f.timezone} disabled={!canEdit} onChange={(e) => set("timezone", e.target.value)} />}
            </Field>
            <Field label="Industry"><Input value={f.industry} disabled={!canEdit} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. Higher education" maxLength={80} /></Field>
            <Field label="Support email" className="sm:col-span-2"><Input type="email" value={f.supportEmail} disabled={!canEdit} onChange={(e) => set("supportEmail", e.target.value)} placeholder="support@example.com" /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={f.description} disabled={!canEdit} onChange={(e) => set("description", e.target.value)} maxLength={1000} /></Field>
          </div>
        </div>
        {canEdit && <div className="mt-4 flex justify-end"><Button variant="primary" className="tracking-[0.06em] uppercase" loading={busy === "save"} onClick={() => run("save", saveGroupDetailsAction(brand, f), () => "Group details saved.")}>Save</Button></div>}
      </KSection>
      <KSection title="Ownership and plan">
        <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="font-semibold text-text">Owner</dt><dd className="text-text-2">{g.ownerName || g.ownerEmail}<span className="block truncate text-[12px] text-text-3">{g.ownerEmail}</span></dd></div>
          <div><dt className="font-semibold text-text">Created On</dt><dd className="text-text-2"><KDate iso={g.createdAt} /></dd></div>
          <div><dt className="font-semibold text-text">Business hours</dt><dd><Link className="text-link hover:underline" href={`/cx/settings/team?brand=${brand}&tab=hours`}>Hours and holidays →</Link></dd></div>
          <div><dt className="font-semibold text-text">Plan</dt><dd><Link className="text-link hover:underline" href={`/cx/plan?brand=${brand}`}>Plan & usage →</Link></dd></div>
        </dl>
        {!isOwner && <Callout tone="info" className="mt-3">Name, domain, country and language belong to the brand&apos;s project, so only its owner can change them.</Callout>}
      </KSection>
    </div>
  );
}
