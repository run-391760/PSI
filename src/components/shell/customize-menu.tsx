"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Pin, PinOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DEFAULT_NAV, isNavItemHidden, moveItem, movePinned, navIsDefault, orderedItems, setItemHidden, togglePin } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CX_NAV, CX_TABS } from "./cx-nav";
import type { NavItem } from "./nav";
import { useUiPrefs } from "./ui-prefs";

const ALL = new Map(CX_NAV.flatMap((g) => g.items.map((i) => [i.href, i] as const)));
const tabLabel = (id: string) => CX_TABS.find((t) => t.id === id)?.label ?? "";

function IconBtn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn("rounded p-1.5 text-text-3 hover:bg-surface-3 hover:text-text disabled:pointer-events-none disabled:opacity-30", active && "text-brand-ink")}
    >
      {children}
    </button>
  );
}

/** Pin, hide and reorder CX sidebar items for the signed-in user (saved server-side). */
export function CustomizeMenuDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, update } = useUiPrefs();
  const nav = prefs.nav;
  const save = (next: typeof nav) => update({ nav: next });

  const row = (item: NavItem, controls: ReactNode, muted?: boolean) => {
    const Icon = item.icon;
    return (
      <li key={item.href} className="flex items-center gap-2 py-1">
        <Icon className={cn("h-4 w-4 shrink-0", muted ? "text-text-3" : "text-text-2")} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px]", muted ? "text-text-3 line-through decoration-text-3/50" : "text-text")}>{item.label}</span>
          {item.defaultHidden && <span className="block text-[11.5px] text-text-3">Hidden by default</span>}
        </span>
        <span className="flex shrink-0 items-center">{controls}</span>
      </li>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Customize menu"
      description="Pin what you use most, hide what you don't. Pinned pages show on every tab. Hidden pages stay available from the ≡ menu and search."
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={navIsDefault(nav)} onClick={() => save(DEFAULT_NAV)} className="mr-auto">
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {nav.pinned.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-text-3 uppercase">Pinned</h3>
          <ul className="divide-y divide-border">
            {nav.pinned.map((h, i) => {
              const item = ALL.get(h);
              if (!item) return null;
              return row(
                item,
                <>
                  <IconBtn label={`Move ${item.label} up`} onClick={() => save(movePinned(nav, h, -1))} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                  <IconBtn label={`Move ${item.label} down`} onClick={() => save(movePinned(nav, h, 1))} disabled={i === nav.pinned.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                  <IconBtn label={`Unpin ${item.label}`} active onClick={() => save(togglePin(nav, h))}><PinOff className="h-3.5 w-3.5" /></IconBtn>
                </>,
              );
            })}
          </ul>
        </section>
      )}
      {CX_NAV.filter((g) => g.label).map((g) => {
        const items = orderedItems(g, nav);
        return (
          <section key={g.id} className="mb-4 last:mb-0">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-text-3 uppercase">
              {tabLabel(g.tab)} · {g.label}
            </h3>
            <ul className="divide-y divide-border">
              {items.map((item, i) => {
                const pinned = nav.pinned.includes(item.href);
                const hidden = isNavItemHidden(item, nav);
                return row(
                  item,
                  <>
                    <IconBtn label={`Move ${item.label} up`} onClick={() => save(moveItem(nav, g, item.href, -1))} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn label={`Move ${item.label} down`} onClick={() => save(moveItem(nav, g, item.href, 1))} disabled={i === items.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`} active={pinned} onClick={() => save(togglePin(nav, item.href))}>{pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</IconBtn>
                    <IconBtn label={hidden ? `Show ${item.label}` : `Hide ${item.label}`} onClick={() => save(setItemHidden(nav, item, !hidden))}>{hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</IconBtn>
                  </>,
                  hidden,
                );
              })}
            </ul>
          </section>
        );
      })}
    </Dialog>
  );
}

/** Button + dialog, for pages (e.g. the Settings hub). */
export function CustomizeMenuButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className={className}>
        <SlidersHorizontal className="h-3.5 w-3.5" /> Customize menu
      </Button>
      <CustomizeMenuDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
