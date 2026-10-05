"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/input";
import { ipAllowed, validateAllowlist } from "@/lib/cx/admin/pure/settings";
import { KSection } from "../../_admin/k-ui";
import { CheckRow, useRun } from "../../_admin/ui";
import { saveIpAction } from "../actions";

/** IP whitelisting editor with the "your current IP must be included" guard checked before saving. */
export function IpClient({ brand, enabled, cidrs, currentIp, isOwner, canEdit }: { brand: string; enabled: boolean; cidrs: string[]; currentIp: string; isOwner: boolean; canEdit: boolean }) {
  const { run, busy, messages } = useRun();
  const [on, setOn] = useState(enabled);
  const [text, setText] = useState(cidrs.join("\n"));
  const lines = text.split("\n");
  const check = validateAllowlist(lines, on, currentIp);
  const included = check.ok ? ipAllowed(currentIp, check.cidrs) : false;
  return (
    <KSection title="IP whitelisting">
      {messages}
      <div className="space-y-4">
        <Callout tone="info" title={`Your current IP: ${currentIp || "unknown"}`}>
          {included ? "It is in the list." : "It is not in the list yet."} When the allowlist is on, CX pages and the CX API for this brand only answer requests from these addresses. {isOwner ? "As the brand owner you are never locked out." : "The brand owner is never locked out."}
        </Callout>
        <CheckRow checked={on} disabled={!canEdit} onChange={setOn} label="Restrict access to these IP addresses" hint="Single addresses (203.0.113.7) or CIDR ranges (203.0.113.0/24, 2001:db8::/32), one per line. # starts a comment." />
        <Textarea aria-label="Allowed IP addresses and ranges" rows={8} disabled={!canEdit} value={text} onChange={(e) => setText(e.target.value)} placeholder={"203.0.113.0/24\n198.51.100.7   # office"} className="font-mono text-[12.5px]" />
        {!check.ok && text.trim() && <p className="text-[12.5px] text-critical-ink">{check.error}</p>}
        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2">
            {currentIp && !included && <Button onClick={() => setText((t) => `${t.trim() ? `${t.trim()}\n` : ""}${currentIp}`)}>Add my IP</Button>}
            <Button variant="primary" disabled={!check.ok} loading={busy === "save"} onClick={() => run("save", saveIpAction(brand, { enabled: on, lines }), (c) => (on ? `Allowlist on with ${c.length} entr${c.length === 1 ? "y" : "ies"}.` : "Allowlist saved (off)."))}>Save</Button>
          </div>
        )}
      </div>
    </KSection>
  );
}
