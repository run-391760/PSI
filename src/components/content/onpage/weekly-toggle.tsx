"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { setWeeklyAction } from "@/app/(app)/on-page-checker/actions";

/** Toggle the weekly background re-check of all pages. */
export function WeeklyToggle({ projectId, enabled, next }: { projectId: string; enabled: boolean; next: string | null }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [on, setOn] = useOptimistic(enabled);
  return (
    <label
        title={on && next ? `Next re-check ${next}` : "Fetch all pages again every week and refresh ideas"}
        className="inline-flex h-8.5 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-2 shadow-card select-none">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[var(--brand)]"
          checked={on}
          onChange={(e) => {
            const v = e.target.checked;
            start(async () => {
              setOn(v);
              await setWeeklyAction(projectId, v);
              router.refresh();
            });
          }}
        />
        Weekly re-check
      </label>
  );
}
