"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDashboardAction } from "@/app/(app)/cx/dashboards/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { TEMPLATES } from "@/lib/cx/insights/widget-defs";
import { cn } from "@/lib/utils";

export function NewDashboardButton({ brand, variant = "primary" }: { brand: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("support");
  const [shared, setShared] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New dashboard
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New dashboard"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!name.trim()}
              onClick={() =>
                start(async () => {
                  const r = await createDashboardAction(brand, { name, description, shared, template });
                  if (!r.ok) return setError(r.error);
                  router.push(`/cx/dashboards/${r.data.id}?brand=${brand}`);
                })
              }
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Callout tone="critical">{error}</Callout>}
          <Field label="Name" htmlFor="nd-name">
            <Input id="nd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly support review" autoFocus />
          </Field>
          <Field label="Description" htmlFor="nd-desc">
            <Textarea id="nd-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium text-text-2">Start from</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => setTemplate(t.id)} className={cn("rounded-md border px-3 py-2 text-left", template === t.id ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-2")}>
                  <div className="text-[13px] font-medium text-text">{t.name}</div>
                  <div className="text-[12px] text-text-3">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone on this brand
          </label>
        </div>
      </Dialog>
    </>
  );
}
