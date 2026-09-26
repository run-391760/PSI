"use client";

import { Check, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { DATABASES } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { updateProjectAction } from "../actions";
import { DeleteProjectDialog } from "../delete-project-dialog";

type Props = {
  project: { id: string; name: string; domain: string; country: string; device: "desktop" | "mobile"; location: string; competitors: string[]; brand_terms: string[] };
};

const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Edit project name, market, device, location, competitors and brand terms; delete the project. */
export function ProjectSettings({ project }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  const [competitors, setCompetitors] = useState(project.competitors.join("\n"));
  const count = lines(competitors).length;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    const list = lines(competitors);
    if (list.length > 10) return setError("A project can have up to 10 competitors.");
    start(async () => {
      const res = await updateProjectAction(project.id, {
        name: String(f.get("name") || "").trim() || project.domain,
        country: String(f.get("country") || "US") as never,
        device: String(f.get("device")) === "mobile" ? "mobile" : "desktop",
        location: String(f.get("location") || ""),
        competitors: list,
        brand_terms: lines(String(f.get("brand_terms") || "")),
      });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader title="Project settings" description="Market and device apply to Position Tracking and the domain snapshot." />
        <CardBody>
          <form onSubmit={submit} className="space-y-4" onChange={() => setSaved(false)}>
            {error && <Callout tone="critical">{error}</Callout>}
            {saved && <Callout tone="good">Settings saved.</Callout>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project name" htmlFor="s-name">
                <Input id="s-name" name="name" defaultValue={project.name} maxLength={100} required />
              </Field>
              <Field label="Domain" htmlFor="s-domain" hint="The domain can't be changed. Create a new project for another site.">
                <Input id="s-domain" value={project.domain} disabled readOnly />
              </Field>
              <Field label="Main market" htmlFor="s-country">
                <Select id="s-country" name="country" defaultValue={project.country}>
                  {DATABASES.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.flag} {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Device" htmlFor="s-device">
                <Select id="s-device" name="device" defaultValue={project.device}>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </Select>
              </Field>
            </div>
            <Field label="City or region" htmlFor="s-location" hint="Optional. Used by local rank tracking and Map Rank Tracker.">
              <Input id="s-location" name="location" defaultValue={project.location} maxLength={120} placeholder="e.g. Vadodara, Gujarat" />
            </Field>
            <Field
              label={
                <span className="flex items-center justify-between">
                  <span>Competitors</span>
                  <span className={count > 10 ? "text-critical-ink" : "text-text-3"}>{count} / 10</span>
                </span>
              }
              htmlFor="s-competitors"
              hint="One domain per line. Used by Position Tracking share of voice, Keyword Gap and reports."
              error={count > 10 ? "Remove some competitors (maximum 10)." : undefined}
            >
              <Textarea id="s-competitors" value={competitors} onChange={(e) => setCompetitors(e.target.value)} rows={5} placeholder={"competitor1.com\ncompetitor2.com"} />
            </Field>
            <Field label="Brand terms" htmlFor="s-brand" hint="Comma or line separated. Used to split branded vs non-branded keywords and for Brand Monitoring.">
              <Input id="s-brand" name="brand_terms" defaultValue={project.brand_terms.join(", ")} placeholder="Acme, Acme Corp" />
            </Field>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button type="submit" variant="primary" loading={pending} disabled={count > 10}>
                {!pending && <Check className="h-4 w-4" />} Save changes
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card className="h-fit border-critical/30">
        <CardHeader title="Danger zone" />
        <CardBody className="space-y-3 text-[13px] text-text-2">
          <p>Deleting the project removes all of its tool data: audits, tracked keywords and positions, schedules, alerts and project reports.</p>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" /> Delete project
          </Button>
        </CardBody>
      </Card>
      <DeleteProjectDialog project={project} open={deleting} onClose={() => setDeleting(false)} redirectTo="/projects" />
    </div>
  );
}
