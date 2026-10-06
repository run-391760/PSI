"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState, useTransition } from "react";
import { createProjectAction } from "@/app/(app)/projects/actions";
import { DATABASES } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

type FormState = { pending: boolean; error: string | null };

/**
 * Create-project form. After creation navigates to `redirectTo` with {id} replaced
 * (e.g. "/site-audit?project={id}"), defaulting to the project dashboard. With `onStateChange` the
 * form leaves its buttons and error out, so a Dialog can render them in its footer (`form={formId}`).
 */
export function ProjectForm({
  redirectTo = "/projects/{id}",
  onDone,
  defaultDomain,
  formId,
  onStateChange,
}: {
  redirectTo?: string;
  onDone?: () => void;
  defaultDomain?: string;
  formId?: string;
  onStateChange?: (s: FormState) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => onStateChange?.({ pending, error }), [pending, error, onStateChange]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const f = new FormData(e.currentTarget);
    const domain = String(f.get("domain") || "");
    const lines = (name: string) =>
      String(f.get(name) || "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    start(async () => {
      const res = await createProjectAction({
        name: String(f.get("name") || "") || domain,
        domain,
        country: String(f.get("country") || "US") as never,
        device: String(f.get("device") || "desktop") as "desktop" | "mobile",
        location: String(f.get("location") || ""),
        competitors: lines("competitors"),
        brand_terms: lines("brand_terms"),
      });
      if (!res.ok) return setError(res.error);
      onDone?.();
      router.push(redirectTo.replace("{id}", res.data.id));
      router.refresh();
    });
  };
  return (
    <form id={formId} onSubmit={submit} className="space-y-3.5">
      {error && !onStateChange && <Callout tone="critical">{error}</Callout>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Domain" htmlFor="p-domain" hint="Root domain, e.g. example.com">
          <Input id="p-domain" name="domain" required defaultValue={defaultDomain} placeholder="example.com" autoFocus />
        </Field>
        <Field label="Project name" htmlFor="p-name">
          <Input id="p-name" name="name" placeholder="My website" />
        </Field>
        <Field label="Main market" htmlFor="p-country">
          <Select id="p-country" name="country" defaultValue="US">
            {DATABASES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.flag} {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Device" htmlFor="p-device">
          <Select id="p-device" name="device" defaultValue="desktop">
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
          </Select>
        </Field>
      </div>
      <Field label="City or region (optional)" htmlFor="p-location" hint="Used by local rank tracking.">
        <Input id="p-location" name="location" placeholder="e.g. Vadodara, Gujarat" />
      </Field>
      <Field label="Competitors" htmlFor="p-competitors" hint="Up to 10 domains, one per line.">
        <Textarea id="p-competitors" name="competitors" rows={3} placeholder={"competitor1.com\ncompetitor2.com"} className="min-h-0" />
      </Field>
      <Field label="Brand terms (optional)" htmlFor="p-brand" hint="Names people use for your brand; comma or line separated.">
        <Input id="p-brand" name="brand_terms" placeholder="Acme, Acme Corp" />
      </Field>
      {!onStateChange && (
        <div className="flex justify-end gap-2 pt-1">
          {onDone && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" loading={pending}>
            Create project
          </Button>
        </div>
      )}
    </form>
  );
}

export function NewProjectButton({ redirectTo, label = "Create project", variant = "primary", defaultDomain }: { redirectTo?: string; label?: string; variant?: "primary" | "secondary"; defaultDomain?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ pending: false, error: null });
  const formId = useId();
  const close = () => {
    setOpen(false);
    setState({ pending: false, error: null });
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Create a project"
        description="A project groups the tools that monitor one website."
        dismissible={!state.pending}
        error={state.error}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={state.pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={state.pending}>
              Create project
            </Button>
          </>
        }
      >
        <ProjectForm redirectTo={redirectTo} onDone={close} defaultDomain={defaultDomain} formId={formId} onStateChange={setState} />
      </Dialog>
    </>
  );
}
