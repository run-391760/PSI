"use client";

import { ChevronDown, Settings } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PROFILE_COLORS, isHexColor } from "@/lib/cx/admin/pure/settings";
import { cn } from "@/lib/utils";

/** Konnect-style gear + caret menu for table rows and cards. */
export function GearMenu({ label, children }: { label: string; children: ReactNode | ((close: () => void) => ReactNode) }) {
  return (
    <Menu
      align="right"
      trigger={(open) => (
        <button type="button" aria-label={label} aria-expanded={open} className={cn("inline-flex h-7 items-center gap-0.5 rounded px-1 text-text-2 hover:bg-surface-3 hover:text-text", open && "bg-surface-3 text-text")}>
          <Settings className="h-4 w-4" />
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
    >
      {children}
    </Menu>
  );
}

/** A section card with an uppercase or plain title and a right-aligned action (ADD PROFILE, ADD CLUSTER…). */
export function KSection({ title, action, children, className, upper }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; upper?: boolean }) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface shadow-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
        <h2 className={cn("min-w-0 text-text", upper ? "text-[12px] font-semibold tracking-[0.08em] uppercase" : "text-[16px] font-semibold")}>{title}</h2>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className="px-4 pb-4 sm:px-5">{children}</div>
    </section>
  );
}

/** Uppercase action button like Konnect's (ADD PROFILE…), built on the kit button. */
export function KButton({ children, variant = "primary", ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button variant={variant} size="sm" {...props} className={cn("tracking-[0.06em] uppercase", props.className)}>
      {children}
    </Button>
  );
}

export function ColorDot({ color, className, label }: { color: string; className?: string; label?: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

/** Pick one of the palette colors or type a hex value. */
export function ColorDialog({ open, title, value, onClose, onSave, busy }: { open: boolean; title: string; value: string; onClose: () => void; onSave: (c: string) => void; busy?: boolean }) {
  const [c, setC] = useState(value);
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={title}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!isHexColor(c)} onClick={() => onSave(c)}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-6 gap-2">
          {PROFILE_COLORS.map((p) => (
            <button key={p} type="button" aria-label={`Color ${p}`} aria-pressed={c.toLowerCase() === p} onClick={() => setC(p)} className={cn("h-8 rounded-md border-2", c.toLowerCase() === p ? "border-text" : "border-transparent")} style={{ background: p }} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Custom color" value={isHexColor(c) ? c : "#3e63dd"} onChange={(e) => setC(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-surface" />
          <Input aria-label="Hex color" value={c} onChange={(e) => setC(e.target.value.trim())} className="w-32 font-mono" />
        </div>
      </div>
    </Dialog>
  );
}

/** Initials avatar (or an image when given). */
export function KAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const initials = (name || "?").replace(/^[@#]/, "").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  if (src) return <img src={src} alt="" className={cn("h-9 w-9 shrink-0 rounded-full object-cover", className)} />;
  return <span aria-hidden className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12.5px] font-semibold text-link", className)}>{initials}</span>;
}

/** dd/mm/yyyy hh:mm AM/PM in the viewer's time zone (Konnect's "Created On" format). */
export function KDate({ iso, time = true }: { iso: string | null | undefined; time?: boolean }) {
  if (!iso) return <>n/a</>;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const h = d.getHours() % 12 || 12;
  const text = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}${time ? ` ${p(h)}:${p(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}` : ""}`;
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
