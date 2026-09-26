"use client";

import { Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { createCampaignAction } from "@/app/(app)/ppc-keyword-tool/actions";
import { DATABASES } from "@/lib/domain";
import { AD_MATCHES, autoGroup, type AdMatch } from "@/lib/keywords/ppc-model";
import { parseKeywordInput } from "@/lib/keywords/text";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";

/** New campaign form: keywords are auto-grouped into ad groups by common words (preview shown live). */
export function NewCampaignForm({ defaultKeywords = "", defaultDb = "US", defaultName = "" }: { defaultKeywords?: string; defaultDb?: string; defaultName?: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [db, setDb] = useState(defaultDb);
  const [text, setText] = useState(defaultKeywords);
  const [group, setGroup] = useState(true);
  const [match, setMatch] = useState<AdMatch>("phrase");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const parsed = useMemo(() => parseKeywordInput(text, 5000), [text]);
  const preview = useMemo(() => (group && parsed.keywords.length ? autoGroup(parsed.keywords) : []), [group, parsed.keywords]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCampaignAction({ name: name || parsed.keywords[0] || "New campaign", db, keywords: parsed.keywords, autoGroup: group, match });
      if (!res.ok) return setError(res.error);
      router.push(`/ppc-keyword-tool?campaign=${res.data}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Callout tone="critical">{error}</Callout>}
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Field label="Campaign name" htmlFor="pc-name">
          <Input id="pc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Running shoes – Search" maxLength={80} />
        </Field>
        <Field label="Location (database)" htmlFor="pc-db">
          <Select id="pc-db" value={db} onChange={(e) => setDb(e.target.value)}>
            {DATABASES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.flag} {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Keywords" htmlFor="pc-kw" hint={`${parsed.keywords.length.toLocaleString()} unique keywords · one per line or comma separated · up to 5,000`}>
        <Textarea id="pc-kw" value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={"running shoes\nrunning shoes for women\ntrail running shoes\nbest running shoes for men"} />
      </Field>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
          <Checkbox checked={group} onChange={(e) => setGroup(e.target.checked)} /> Auto-group by common words
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-2">
          Default match type
          <Select value={match} onChange={(e) => setMatch(e.target.value as AdMatch)} className="h-7.5 w-auto text-[12.5px]">
            {AD_MATCHES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {preview.length > 0 && (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="mb-1 text-[12px] font-medium text-text-2">Preview: {preview.length} ad groups</div>
          <div className="flex flex-wrap gap-1.5">
            {preview.slice(0, 24).map((g) => (
              <span key={g.name} className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-[12px] text-text">
                {g.name} <span className="text-text-3">{g.keywords.length}</span>
              </span>
            ))}
            {preview.length > 24 && <span className="text-[12px] text-text-3">+{preview.length - 24} more</span>}
          </div>
        </div>
      )}
      <Button type="submit" variant="primary" loading={pending}>
        <Megaphone className="h-4 w-4" /> Create campaign
      </Button>
    </form>
  );
}
