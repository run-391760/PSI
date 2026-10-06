"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Pin, PinOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { isNavItemHidden, moveItem, movePinned, orderedItems, scopeNav, setItemHidden, togglePin } from "@/lib/cx/ui/prefs-logic";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CX_NAV, CX_TABS, type CxNavGroup } from "./cx-nav";
import { NAV, navGroupTitle, type NavGroup, type NavItem } from "./nav";
import { useUiPrefs } from "./ui-prefs";

type Workspace = "cx" | "seo";
type MenuGroup = Pick<NavGroup, "id" | "label" | "items">;

const tabLabel = (id: string) => CX_TABS.find((t) => t.id === id)?.label ?? "";

/**
 * Each workspace's menu: `menu` = every group of it (pins and resets are scoped to these), `groups` =
 * the ones the dialog lists, with a heading (unlabelled CX groups are not customisable).
 */
const WORKSPACES: Record<Workspace, { menu: MenuGroup[]; groups: MenuGroup[]; heading: (g: MenuGroup) => string; description: string }> = {
  cx: {
    menu: CX_NAV,
    groups: CX_NAV.filter((g) => g.label),
    heading: (g) => `${tabLabel((g as CxNavGroup).tab)} · ${g.label}`,
    description: "Pin what you use most, hide what you don't. Pinned pages show on every tab. Hidden pages stay available from the ≡ menu and search.",
  },
  seo: {
    menu: NAV,
    groups: NAV,
    heading: (g) => navGroupTitle(g as NavGroup) || "Main",
    description: "Pin what you use most, hide what you don't. Hidden tools stay available from search and the All tools list on Home.",
  },
};

/** Section heading inside the dialog, in the shell's label style. */
const heading = "mb-1 text-[11.5px] font-semibold tracking-[0.08em] text-text-2 uppercase";

function IconBtn({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn("rounded p-2 text-text-3 hover:bg-surface-3 sm:p-1.5 hover:text-text disabled:pointer-events-none disabled:opacity-30", active && "text-brand-ink")}
    >
      {children}
    </button>
  );
}

/**
 * Pin, hide and reorder sidebar items for the signed-in user (saved server-side). `workspace` picks
 * the menu (CX by default). Both workspaces share prefs.nav; their hrefs and group ids never collide.
 */
export function CustomizeMenuDialog({ open, onClose, workspace = "cx" }: { open: boolean; onClose: () => void; workspace?: Workspace }) {
  const { prefs, update } = useUiPrefs();
  const nav = prefs.nav;
  const ws = WORKSPACES[workspace];
  const all = new Map(ws.menu.flatMap((g) => g.items.map((i) => [i.href, i] as const)));
  // Pins, hides and order of this workspace only, so resetting one menu keeps the other's customisation.
  const { own, scoped, pinned, reset } = scopeNav(nav, ws.menu);
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
      description={ws.description}
      initialFocus="none"
      footerStart={
        <Button variant="ghost" disabled={!scoped} onClick={() => save(reset())}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset to default
        </Button>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {pinned.length > 0 && (
        <section className="mb-4">
          <h3 className={heading}>Pinned</h3>
          <ul className="divide-y divide-border">
            {pinned.map((h, i) => {
              const item = all.get(h);
              if (!item) return null;
              return row(
                item,
                <>
                  <IconBtn label={`Move ${item.label} up`} onClick={() => save(movePinned(nav, h, -1, own))} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                  <IconBtn label={`Move ${item.label} down`} onClick={() => save(movePinned(nav, h, 1, own))} disabled={i === pinned.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                  <IconBtn label={`Unpin ${item.label}`} active onClick={() => save(togglePin(nav, h))}><PinOff className="h-3.5 w-3.5" /></IconBtn>
                </>,
              );
            })}
          </ul>
        </section>
      )}
      {ws.groups.map((g) => {
        const items = orderedItems(g, nav);
        return (
          <section key={g.id} className="mb-4 last:mb-0">
            <h3 className={heading}>{ws.heading(g)}</h3>
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
export function CustomizeMenuButton({ className, workspace }: { className?: string; workspace?: Workspace }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className={className}>
        <SlidersHorizontal className="h-3.5 w-3.5" /> Customize menu
      </Button>
      <CustomizeMenuDialog open={open} onClose={() => setOpen(false)} workspace={workspace} />
    </>
  );
}
