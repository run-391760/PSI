"use client";

import { ChevronsLeft, ChevronsRight, Layers, MessageSquareText, Palette, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { NetworkIcon } from "@/components/cx/network-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, MenuItem } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Input } from "@/components/ui/input";
import { clusterChips, splitPicker } from "@/lib/cx/admin/pure/settings";
import { ColorDialog, ColorDot, GearMenu, KButton, KDate, KSection } from "../_admin/k-ui";
import { useRun } from "../_admin/ui";
import { clusterColorAction, deleteClusterAction, saveClusterAction } from "./actions";

export type PickItem = { id: string; name: string; network: string; type: "channel" | "topic" | "source" };
export type ClusterRow = { id: string; name: string; color: string; isDefault: boolean; channelIds: string[]; topicIds: string[]; sources: string[]; creator: string | null; createdAt: string };

const sourceId = (s: string) => `source:${s}`;

/** Clusters table (screenshot 10): name, per-network profile chips (incl. Topic), created by, gear menu. */
export function ClustersClient({ brand, clusters, items, canEdit }: { brand: string; clusters: ClusterRow[]; items: PickItem[]; canEdit: boolean }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<ClusterRow | "new" | null>(null);
  const [color, setColor] = useState<ClusterRow | null>(null);
  const [del, setDel] = useState<ClusterRow | null>(null);
  const kindOf = (id: string) => items.find((i) => i.id === id && i.type === "channel")?.network;
  return (
    <KSection title="Clusters" action={canEdit && <KButton onClick={() => setEdit("new")}><Plus className="h-3.5 w-3.5" />Add cluster</KButton>}>
      {messages}
      {!canEdit && <Callout tone="info" className="mb-3">Only brand admins and supervisors can change clusters. You can still pick them in filters and reports.</Callout>}
      {clusters.length === 0 ? (
        <EmptyState icon={<Layers className="h-5 w-5" />} title="No clusters yet" description={items.length ? "Group profiles and topics under one name, for example “Overall” or one per campus, to filter tickets, messages and reports by it." : "Add profiles in Omni-Channel Setup or topics first, then group them here."} action={canEdit && items.length ? <KButton onClick={() => setEdit("new")}><Plus className="h-3.5 w-3.5" />Add cluster</KButton> : undefined} />
      ) : (
        <div className="divide-y divide-border">
          <div className="hidden grid-cols-[minmax(140px,1fr)_3fr_minmax(150px,1fr)_48px] gap-3 pb-2 text-[11.5px] font-semibold tracking-wide text-text uppercase md:grid">
            <span>Cluster name</span><span>Profiles</span><span>Created by</span><span className="sr-only">Actions</span>
          </div>
          {clusters.map((c) => {
            const chips = clusterChips(c.channelIds.map(kindOf).filter((k): k is string => !!k), c.topicIds.filter((id) => items.some((i) => i.id === id)).length, c.sources.length);
            return (
              <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 py-3 md:grid-cols-[minmax(140px,1fr)_3fr_minmax(150px,1fr)_48px]">
                <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-text">
                  <ColorDot color={c.color} label={`Color ${c.color}`} />
                  <span className="truncate" title={c.name}>{c.name}</span>
                  {c.isDefault && <Badge tone="brand" title="Applied when the inbox opens without a cluster"><Star className="h-3 w-3" />Default</Badge>}
                </div>
                <div className="justify-self-end md:order-last">
                  {canEdit && (
                    <GearMenu label={`Actions for ${c.name}`}>
                      {(close) => (
                        <>
                          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { close(); setEdit(c); }}>Edit Cluster</MenuItem>
                          <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); setDel(c); }}>Delete Cluster</MenuItem>
                          <MenuItem icon={<Palette className="h-3.5 w-3.5" />} onClick={() => { close(); setColor(c); }}>Edit Color</MenuItem>
                        </>
                      )}
                    </GearMenu>
                  )}
                </div>
                <div className="col-span-2 flex flex-wrap gap-1.5 md:col-span-1">
                  {chips.length ? chips.map((ch) => <span key={ch.kind} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] font-semibold text-text-2">{ch.label}</span>) : <span className="text-[12px] text-text-3">Its profiles and topics were deleted</span>}
                </div>
                <div className="col-span-2 text-[12.5px] text-text-2 md:col-span-1"><div className="truncate">{c.creator ?? "n/a"}</div><KDate iso={c.createdAt} /></div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <ClusterDialog brand={brand} cluster={edit === "new" ? null : edit} items={items} onClose={() => setEdit(null)} />}
      {color && <ColorDialog open title={`Color for ${color.name}`} value={color.color} busy={busy === "color"} onClose={() => setColor(null)} onSave={async (v) => { await run("color", clusterColorAction(brand, color.id, v), () => "Color saved."); setColor(null); }} />}
      <Dialog open={!!del} onClose={() => setDel(null)} size="sm" title="Delete cluster?" description="Profiles, topics and tickets are not affected; filters and reports using this cluster fall back to everything."
        footer={<><Button onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" loading={busy === "del"} onClick={async () => { if (del) await run("del", deleteClusterAction(brand, del.id), () => `${del.name} deleted.`); setDel(null); }}>Delete</Button></>}>
        <p className="text-[13px] text-text-2">{del?.name}</p>
      </Dialog>
    </KSection>
  );
}

function ItemIcon({ item }: { item: PickItem }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-2">
      {item.type === "topic" ? <MessageSquareText className="h-4 w-4" /> : <NetworkIcon kind={item.network} className="h-4 w-4" />}
    </span>
  );
}

function PickRow({ item, add, onMove }: { item: PickItem; add: boolean; onMove: () => void }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      <ItemIcon item={item} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text" title={item.name}>
        {item.name}
        {item.type === "topic" && <span className="ml-1.5 text-[11.5px] font-normal text-text-3">Topic</span>}
      </span>
      <Button size="sm" variant="primary" className="h-7 w-9 px-0" aria-label={add ? `Add ${item.name}` : `Remove ${item.name}`} onClick={onMove}>
        {add ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
      </Button>
    </li>
  );
}

/** Edit Cluster dialog (screenshot 11): name, "Search Profiles…", Selected vs Other lists with »/« buttons, CLOSE / UPDATE. */
function ClusterDialog({ brand, cluster, items, onClose }: { brand: string; cluster: ClusterRow | null; items: PickItem[]; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [name, setName] = useState(cluster?.name ?? "");
  const [q, setQ] = useState("");
  const [isDefault, setDefault] = useState(cluster?.isDefault ?? false);
  const [selected, setSelected] = useState<string[]>(cluster ? [...cluster.channelIds, ...cluster.topicIds, ...cluster.sources.map(sourceId)] : []);
  const lists = splitPicker(items, selected, q);
  const save = async () => {
    const pick = (t: PickItem["type"]) => items.filter((i) => i.type === t && selected.includes(i.id));
    const ok = await run(
      "save",
      saveClusterAction(brand, { id: cluster?.id, name, channelIds: pick("channel").map((i) => i.id), topicIds: pick("topic").map((i) => i.id), sources: pick("source").map((i) => i.network), isDefault }),
      () => (cluster ? "Cluster updated." : "Cluster created."),
    );
    if (ok) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="xl" title={cluster ? "Edit Cluster" : "Add Cluster"}
      footer={<><Button className="tracking-[0.06em] uppercase" onClick={onClose}>Close</Button><Button variant="primary" className="tracking-[0.06em] uppercase" loading={busy === "save"} onClick={save}>{cluster ? "Update" : "Create"}</Button></>}>
      <div className="space-y-3">
        {messages}
        <Input aria-label="Cluster name" placeholder="Cluster name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="bg-surface-2" />
        <Input aria-label="Search profiles and topics" placeholder="Search Profiles…" value={q} onChange={(e) => setQ(e.target.value)} className="bg-surface-2" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-1.5 text-[13.5px] text-text">Selected Profiles/Topics <span className="text-text-3">({selected.length})</span></h3>
            <ul className="scroll-thin max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Selected profiles and topics">
              {lists.selected.length ? lists.selected.map((i) => <PickRow key={i.id} item={i} add={false} onMove={() => setSelected((s) => s.filter((x) => x !== i.id))} />) : <li className="px-3 py-6 text-center text-[12.5px] text-text-3">{q ? "No selected item matches." : "Nothing selected yet. Use « to add."}</li>}
            </ul>
          </div>
          <div className="min-w-0">
            <h3 className="mb-1.5 text-[13.5px] text-text">Other Profiles/Topics</h3>
            <ul className="scroll-thin max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Other profiles and topics">
              {lists.other.length ? lists.other.map((i) => <PickRow key={i.id} item={i} add onMove={() => setSelected((s) => [...s, i.id])} />) : <li className="px-3 py-6 text-center text-[12.5px] text-text-3">{q ? "No match." : "Everything is selected."}</li>}
            </ul>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-text-2"><Checkbox checked={isDefault} onChange={(e) => setDefault(e.target.checked)} />Default cluster (applied when the inbox opens without a cluster selected)</label>
      </div>
    </Dialog>
  );
}
