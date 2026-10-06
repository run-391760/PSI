"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { saveProfileAction } from "@/app/(app)/local/actions";
import { CATEGORY_SUGGESTIONS, DAYS, profileInput, type ProfileInput } from "@/lib/local/profile-schema";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Errors = Partial<Record<string, string>>;

type FormState = { pending: boolean; error: string | null };

/**
 * Business profile editor (name, address, phone, website, categories, hours, description, photos).
 * With `onStateChange` the form leaves its buttons and error out, so a Dialog footer can render them (`form={formId}`).
 */
export function ProfileForm({
  projectId,
  initial,
  onDone,
  submitLabel = "Save profile",
  formId,
  onStateChange,
}: {
  projectId: string;
  initial: ProfileInput;
  onDone?: () => void;
  submitLabel?: string;
  formId?: string;
  onStateChange?: (s: FormState) => void;
}) {
  const router = useRouter();
  const [hours, setHours] = useState(initial.hours);
  const [description, setDescription] = useState(initial.description ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => onStateChange?.({ pending, error: formError }), [pending, formError, onStateChange]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const num = (k: string) => (s(k) === "" ? null : Number(s(k)));
    const input: ProfileInput = {
      name: s("name"),
      street: s("street"),
      city: s("city"),
      region: s("region"),
      postalCode: s("postalCode"),
      phone: s("phone"),
      website: s("website"),
      primaryCategory: s("primaryCategory"),
      categories: s("categories")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      hours,
      description,
      photos: Number(s("photos") || 0),
      lat: num("lat"),
      lng: num("lng"),
    };
    const parsed = profileInput.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === "hours" ? "hours" : String(issue.path[0]);
        next[key] ??= issue.message;
      }
      if ((input.lat == null) !== (input.lng == null)) next.lat ??= "Enter both latitude and longitude, or neither.";
      setErrors(next);
      setFormError("Please fix the highlighted fields.");
      return;
    }
    if ((input.lat == null) !== (input.lng == null)) {
      setErrors({ lat: "Enter both latitude and longitude, or neither." });
      return;
    }
    setErrors({});
    setFormError(null);
    start(async () => {
      const res = await saveProfileAction(projectId, input);
      if (!res.ok) return setFormError(res.error);
      setSaved(true);
      onDone?.();
      router.refresh();
    });
  };

  const setDay = (i: number, patch: Partial<(typeof hours)[number]>) => setHours((h) => h.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
      {formError && !onStateChange && <Callout tone="critical">{formError}</Callout>}
      {saved && !formError && !onDone && <Callout tone="good">Profile saved.</Callout>}
      <section>
        <h3 className="mb-2.5 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Business</h3>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Business name" htmlFor="bp-name" error={errors.name}>
            <Input id="bp-name" name="name" defaultValue={initial.name} required maxLength={100} />
          </Field>
          <Field label="Primary category" htmlFor="bp-cat" error={errors.primaryCategory} hint="The main category customers search for.">
            <Input id="bp-cat" name="primaryCategory" defaultValue={initial.primaryCategory} list="bp-cat-list" required placeholder="e.g. Dentist" />
            <datalist id="bp-cat-list">
              {CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Additional categories" htmlFor="bp-cats" error={errors.categories} hint="Comma separated, up to 9." className="sm:col-span-2">
            <Input id="bp-cats" name="categories" defaultValue={(initial.categories ?? []).join(", ")} placeholder="e.g. Orthodontist, Cosmetic dentist" />
          </Field>
        </div>
      </section>
      <section>
        <h3 className="mb-2.5 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Location & contact</h3>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Street address" htmlFor="bp-street" error={errors.street} className="sm:col-span-2">
            <Input id="bp-street" name="street" defaultValue={initial.street} required placeholder="e.g. 12, Alkapuri Main Road" />
          </Field>
          <Field label="City" htmlFor="bp-city" error={errors.city}>
            <Input id="bp-city" name="city" defaultValue={initial.city} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State / region" htmlFor="bp-region" error={errors.region}>
              <Input id="bp-region" name="region" defaultValue={initial.region} />
            </Field>
            <Field label="Postal code" htmlFor="bp-postal" error={errors.postalCode}>
              <Input id="bp-postal" name="postalCode" defaultValue={initial.postalCode} />
            </Field>
          </div>
          <Field label="Phone" htmlFor="bp-phone" error={errors.phone}>
            <Input id="bp-phone" name="phone" type="tel" defaultValue={initial.phone} required placeholder="Include the country code" />
          </Field>
          <Field label="Website" htmlFor="bp-web" error={errors.website}>
            <Input id="bp-web" name="website" type="url" defaultValue={initial.website} placeholder="https://www.example.com/" />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <Field label="Latitude (optional)" htmlFor="bp-lat" error={errors.lat} hint="Centre of the map grid. Leave empty to use the city centre.">
              <Input id="bp-lat" name="lat" type="number" step="any" defaultValue={initial.lat ?? ""} placeholder="e.g. 30.2672" />
            </Field>
            <Field label="Longitude (optional)" htmlFor="bp-lng" error={errors.lng}>
              <Input id="bp-lng" name="lng" type="number" step="any" defaultValue={initial.lng ?? ""} placeholder="e.g. -97.7431" />
            </Field>
          </div>
        </div>
      </section>
      <section>
        <h3 className="mb-2.5 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Opening hours</h3>
        {errors.hours && <p className="mb-2 text-[12px] text-critical-ink">{errors.hours}</p>}
        <div className="divide-y divide-border rounded-md border border-border">
          {hours.map((h, i) => (
            <div key={h.day} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-24 text-[13px] font-medium text-text">{DAYS[i].label}</span>
              <label className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
                <Checkbox checked={h.closed} onChange={(e) => setDay(i, { closed: e.target.checked })} /> Closed
              </label>
              <div className={cn("ml-auto flex items-center gap-1.5", h.closed && "opacity-40")}>
                <Input type="time" aria-label={`${DAYS[i].label} opens`} value={h.open} disabled={h.closed} onChange={(e) => setDay(i, { open: e.target.value })} className="h-7.5 w-[124px]" />
                <span className="text-text-3">–</span>
                <Input type="time" aria-label={`${DAYS[i].label} closes`} value={h.close} disabled={h.closed} onChange={(e) => setDay(i, { close: e.target.value })} className="h-7.5 w-[124px]" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-3.5 sm:grid-cols-[1fr_160px]">
        <Field label="Description" htmlFor="bp-desc" error={errors.description} hint={`${description.length}/750 characters. Aim for 250+ describing services, area served and what makes you different.`}>
          <Textarea id="bp-desc" name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={750} rows={4} />
        </Field>
        <Field label="Photos" htmlFor="bp-photos" error={errors.photos} hint="Photos on your profile.">
          <Input id="bp-photos" name="photos" type="number" min={0} max={10000} defaultValue={Number(initial.photos ?? 0)} />
        </Field>
      </section>
      {!onStateChange && (
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {onDone && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" loading={pending}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
