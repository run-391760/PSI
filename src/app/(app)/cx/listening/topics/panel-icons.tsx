"use client";

import { Eye, EyeOff, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { fetchTopicsNowAction } from "./actions";

/** TOPICS panel header: info, show/hide paused topics, fetch now. */
export function TopicsPanelIcons({ brand, canFetch }: { brand: string; canFetch: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const hide = sp.get("paused") === "hide";
  const next = new URLSearchParams(sp.toString());
  if (hide) next.delete("paused");
  else next.set("paused", "hide");
  return (
    <>
      <span title="Topics are the keyword sets listening collects mentions for. Paused topics collect nothing." aria-label="About topics" role="img" className="p-1"><Info className="h-4 w-4" /></span>
      <Link href={`/cx/listening/topics?${next.toString()}`} title={hide ? "Show paused topics" : "Hide paused topics"} aria-label={hide ? "Show paused topics" : "Hide paused topics"}>{hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Link>
      {canFetch && (
        <button type="button" title="Fetch mentions now" aria-label="Fetch mentions now" disabled={busy} onClick={async () => { setBusy(true); await fetchTopicsNowAction(brand); setBusy(false); router.refresh(); }}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      )}
    </>
  );
}
