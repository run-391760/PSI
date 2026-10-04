"use client";

import { Eye, Focus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hiddenNavItems, restorePanels, setItemHidden } from "@/lib/cx/ui/prefs-logic";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/tabs";
import { CX_NAV } from "./cx-nav";
import { CustomizeMenuButton } from "./customize-menu";
import { useUiPrefs } from "./ui-prefs";

/** Display preferences + pages hidden from the menu (Settings hub). */
export function DisplaySettings({ brand }: { brand?: string }) {
  const { prefs, update } = useUiPrefs();
  const router = useRouter();
  const hidden = hiddenNavItems(CX_NAV, prefs.nav);
  const hiddenPanels = Object.values(prefs.panels).filter((p) => p.state === "hidden");
  const withBrand = (h: string) => (brand ? `${h}?brand=${encodeURIComponent(brand)}` : h);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Display" description="Saved to your account and applied on every device." />
        <CardBody className="divide-y divide-border pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0 flex-1 basis-60">
              <div className="text-[13px] font-medium text-text">Focus mode</div>
              <div className="text-[12px] text-text-3">Icon-only menu, no side panels or secondary metrics, full-width content. Shortcut Ctrl/⌘ + \</div>
            </div>
            <Button size="sm" variant={prefs.focus ? "primary" : "secondary"} onClick={() => update({ focus: !prefs.focus })} aria-pressed={prefs.focus}>
              <Focus className="h-3.5 w-3.5" /> {prefs.focus ? "On" : "Off"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0 flex-1 basis-60">
              <div className="text-[13px] font-medium text-text">Density</div>
              <div className="text-[12px] text-text-3">Compact tightens spacing and table text.</div>
            </div>
            <Segmented value={prefs.density} onChange={(v) => update({ density: v })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0 flex-1 basis-60">
              <div className="text-[13px] font-medium text-text">Sidebar menu</div>
              <div className="text-[12px] text-text-3">Pin, hide and reorder CX menu items.</div>
            </div>
            <CustomizeMenuButton />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0 flex-1 basis-60">
              <div className="text-[13px] font-medium text-text">Hidden panels</div>
              <div className="text-[12px] text-text-3">{hiddenPanels.length ? `${hiddenPanels.length} hidden: ${hiddenPanels.map((p) => p.label).join(", ")}` : "No panels hidden. Hover a panel and use its eye button to hide it."}</div>
            </div>
            <Button size="sm" disabled={!hiddenPanels.length} onClick={() => update({ panels: restorePanels(prefs.panels) }).then(() => router.refresh())}>
              <RotateCcw className="h-3.5 w-3.5" /> Show all
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Not in your menu" description="Pages hidden from the sidebar, by you or by default. Open them here or add them back." />
        <CardBody className="pt-0">
          {hidden.length === 0 ? (
            <p className="py-4 text-[13px] text-text-3">Every page is in your menu.</p>
          ) : (
            <ul className="divide-y divide-border">
              {hidden.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href} className="flex items-center gap-2.5 py-2">
                    <Icon className="h-4 w-4 shrink-0 text-text-3" />
                    <Link href={withBrand(item.href)} className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-link hover:underline">{item.label}</span>
                      <span className="block truncate text-[12px] text-text-3">{item.description}</span>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => update({ nav: setItemHidden(prefs.nav, item, false) })} aria-label={`Show ${item.label} in menu`}>
                      <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Show in menu</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
