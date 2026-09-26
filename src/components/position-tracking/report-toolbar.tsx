"use client";

import { CalendarDays, ChevronDown, Monitor, Smartphone, Tag as TagIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { dateLabel } from "@/lib/format";
import type { Device, TagRef } from "@/lib/position-tracking/types";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button";
import { Menu } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";

/** URL-driven report controls: date range, device and tag filter. */
export function ReportToolbar({
  range,
  device,
  devices,
  tags,
  selectedTags,
  startDay,
  endDay,
  showTags = true,
  showDevice = true,
  children,
}: {
  range: number;
  device: Device;
  devices: Device[];
  tags: TagRef[];
  selectedTags: string[];
  startDay: string | null;
  endDay: string | null;
  showTags?: boolean;
  showDevice?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") params.delete(k);
      else params.set(k, v);
    }
    params.delete("kw");
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const toggleTag = (id: string) => {
    const next = selectedTags.includes(id) ? selectedTags.filter((t) => t !== id) : [...selectedTags, id];
    set({ tags: next.join(",") || null });
  };
  const tagLabel = selectedTags.length === 0 ? "All keywords" : selectedTags.length === 1 ? (tags.find((t) => t.id === selectedTags[0])?.name ?? "1 tag") : `${selectedTags.length} tags`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Segmented options={[7, 30, 90].map((d) => ({ value: String(d), label: `${d} days` }))} value={String(range)} onChange={(v) => set({ range: v === "30" ? null : v })} />
      {showDevice && devices.length > 1 && (
        <Segmented
          options={devices.map((d) => ({
            value: d,
            label: (
              <span className="inline-flex items-center gap-1">
                {d === "desktop" ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                {d === "desktop" ? "Desktop" : "Mobile"}
              </span>
            ),
          }))}
          value={device}
          onChange={(v) => set({ device: v })}
        />
      )}
      {showTags && tags.length > 0 && (
        <Menu
          trigger={(open) => (
            <button type="button" className={cn(buttonClass("secondary", "sm"), selectedTags.length > 0 && "border-brand text-brand-ink")} aria-expanded={open}>
              <TagIcon className="h-3.5 w-3.5" /> {tagLabel} <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </button>
          )}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {tags.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-3">
                <Checkbox checked={selectedTags.includes(t.id)} onChange={() => toggleTag(t.id)} />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
          {selectedTags.length > 0 && (
            <button type="button" onClick={() => set({ tags: null })} className="w-full border-t border-border px-3 py-1.5 text-left text-[12.5px] text-link hover:bg-surface-3">
              Clear tag filter
            </button>
          )}
        </Menu>
      )}
      {pending && <Spinner className="h-3.5 w-3.5" />}
      <span className="inline-flex items-center gap-1.5 text-[12px] text-text-3">
        <CalendarDays className="h-3.5 w-3.5" />
        {startDay && endDay ? (startDay === endDay ? dateLabel(endDay) : `${dateLabel(startDay)} – ${dateLabel(endDay)}`) : "No data yet"}
      </span>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
