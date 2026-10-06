"use client";

import { Download, FolderPlus, MoreHorizontal, Pencil, Plus, Shuffle, ShieldMinus, Trash2, X, Copy as CopyIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import {
  addGroupAction,
  addKeywordsAction,
  addNegativesAction,
  crossNegativesAction,
  deleteCampaignAction,
  deleteGroupAction,
  regroupAction,
  removeDuplicatesAction,
  removeKeywordsAction,
  removeNegativesAction,
  renameGroupAction,
  updateCampaignAction,
  updateKeywordsAction,
} from "@/app/(app)/ppc-keyword-tool/actions";
import { downloadCsv } from "@/lib/csv";
import { compact, money } from "@/lib/format";
import { AD_MATCHES, adsEditorRows, estimate, groupTotals, type AdMatch, type CampaignDetail, type PpcGroup, type PpcKeyword, type PpcNegative } from "@/lib/keywords/ppc-model";
import { parseKeywordInput } from "@/lib/keywords/text";
import type { ActionResult } from "@/lib/keywords/types";
import { cn } from "@/lib/utils";
import { KeywordLink } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { Tooltip } from "@/components/ui/tooltip";

const na = <span className="text-text-3">n/a</span>;
const fmtKw = (k: string, m: AdMatch) => AD_MATCHES.find((x) => x.id === m)!.example(k);

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok?: (data: T) => string | void) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await fn();
      if (!res.ok) return setError(res.error);
      const msg = ok?.(res.data);
      if (msg) setNotice(msg);
      router.refresh();
    });
  return { run, pending, error, notice, setError, setNotice };
}

function MatchSelect({ value, onChange, className, label = "Match type" }: { value: AdMatch; onChange: (m: AdMatch) => void; className?: string; label?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as AdMatch)} className={cn("h-7.5 w-auto text-[12.5px]", className)} aria-label={label}>
      {AD_MATCHES.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </Select>
  );
}

export function PpcPlanner({ detail, selected }: { detail: CampaignDetail; selected: string }) {
  const router = useRouter();
  const { campaign, groups } = detail;
  const { run, pending, error, notice, setError } = useRun();
  const [ctr, setCtr] = useState(String(Math.round(campaign.ctr * 1000) / 10));
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [newGroup, setNewGroup] = useState("");
  const all = useMemo(() => groups.flatMap((g) => g.keywords), [groups]);
  const totals = useMemo(() => groupTotals(all, campaign.ctr), [all, campaign.ctr]);
  const negCount = groups.reduce((s, g) => s + g.negatives.length, 0) + detail.campaignNegatives.length;
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const k of all) seen.set(k.keyword, (seen.get(k.keyword) ?? 0) + 1);
    return [...seen.values()].filter((n) => n > 1).length;
  }, [all]);
  const group = groups.find((g) => g.id === selected);
  const base = `/ppc-keyword-tool?campaign=${campaign.id}`;

  const saveCtr = () => {
    const v = Number(ctr);
    if (!Number.isFinite(v) || v === Math.round(campaign.ctr * 1000) / 10) return;
    run(() => updateCampaignAction(campaign.id, { ctr: v / 100 }));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => run(() => regroupAction(campaign.id), (n) => `Keywords regrouped into ${n} ad groups by common words.`)} loading={pending} title="Rebuild ad groups from all keywords by the words they share">
          <Shuffle className="h-4 w-4" /> Auto-group
        </Button>
        <Button onClick={() => run(() => crossNegativesAction(campaign.id), (n) => (n ? `${n} cross-group negative keywords applied.` : "No overlapping keywords between ad groups — no negatives needed."))} loading={pending} title="Add more specific keywords of other groups as negative exact match so each query triggers the most relevant ad group">
          <ShieldMinus className="h-4 w-4" /> Cross-group negatives
        </Button>
        <Button onClick={() => run(() => removeDuplicatesAction(campaign.id), (n) => (n ? `${n} duplicate keywords removed.` : "No duplicates found."))} loading={pending} disabled={!dupes}>
          <CopyIcon className="h-4 w-4" /> Remove duplicates{dupes ? ` (${dupes})` : ""}
        </Button>
        <Button variant="primary" onClick={() => downloadCsv(`${campaign.name.replace(/\s+/g, "-")}_google-ads-editor`, adsEditorRows(detail))} disabled={!all.length}>
          <Download className="h-4 w-4" /> Export for Google Ads Editor
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-[12.5px] text-text-2">
          <Tooltip content="Expected click-through rate of your ads, used for the click and cost estimates. Broad match reaches ~1.5× and phrase ~1.25× the exact-match searches.">
            <span className="underline decoration-dotted underline-offset-2">Ad CTR</span>
          </Tooltip>
          <Input value={ctr} onChange={(e) => setCtr(e.target.value)} onBlur={saveCtr} onKeyDown={(e) => e.key === "Enter" && saveCtr()} type="number" step="0.1" min="0.1" max="50" className="h-7.5 w-18 text-right" aria-label="Ad CTR percent" />
          <span>%</span>
          <Menu
            align="right"
            trigger={() => (
              <Button size="icon" variant="ghost" aria-label="Campaign actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    setName(campaign.name);
                    setRenaming(true);
                  }}
                >
                  Rename campaign
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    setDeleting(true);
                  }}
                >
                  Delete campaign
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
      {error && !renaming && !deleting && <Callout tone="critical" className="mb-3">{error}</Callout>}
      {notice && <Callout tone="good" className="mb-3">{notice}</Callout>}

      <div className="mb-4 rounded-lg border border-border bg-surface shadow-card">
        <MetricStrip>
          <Metric label="Ad groups" value={groups.length} />
          <Metric label="Keywords" value={totals.keywords.toLocaleString()} sub={`${negCount.toLocaleString()} negatives`} />
          <Metric label="Search volume" value={compact(totals.volume)} sub="monthly" />
          <Metric label="Avg. CPC" value={totals.avgCpc == null ? "n/a" : money(totals.avgCpc)} />
          <Metric label="Est. clicks" value={compact(totals.clicks)} sub="per month" info="Volume × ad CTR × match-type reach." />
          <Metric label="Est. cost" value={money(totals.cost)} sub="per month" info="Estimated clicks × keyword CPC." />
        </MetricStrip>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg border border-border bg-surface pt-3 shadow-card lg:self-start">
          <div className="px-3 pb-2 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Ad groups</div>
          <ul className="scroll-thin max-h-[520px] overflow-y-auto px-1.5">
            <li>
              <Link href={`${base}&group=all`} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]", selected === "all" ? "bg-brand-soft font-semibold text-brand-ink" : "text-text hover:bg-surface-3")}>
                <span className="flex-1">All ad groups</span>
                <span className="tabular text-[12px]">{groups.length}</span>
              </Link>
            </li>
            {groups.map((g) => {
              const t = groupTotals(g.keywords, campaign.ctr);
              return (
                <li key={g.id}>
                  <Link href={`${base}&group=${g.id}`} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]", selected === g.id ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text")}>
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="tabular shrink-0 text-[11.5px] text-text-3">{g.keywords.length} · {money(t.cost)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <form
            className="flex gap-1.5 border-t border-border p-2.5"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!newGroup.trim()) return;
              run(() => addGroupAction(campaign.id, newGroup), (id) => {
                setNewGroup("");
                router.push(`${base}&group=${id}`);
              });
            }}
          >
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New ad group" className="h-7.5" maxLength={80} aria-label="New ad group name" />
            <Button size="sm" type="submit" disabled={!newGroup.trim()} aria-label="Add ad group">
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          </form>
        </aside>

        <div className="min-w-0 space-y-4">
          {group ? <GroupPanel key={group.id} group={group} detail={detail} /> : <GroupsOverview detail={detail} />}
          <NegativesCard title="Campaign negative keywords" description="Block these searches for every ad group in the campaign." campaignId={campaign.id} groupId={null} negatives={detail.campaignNegatives} />
        </div>
      </div>

      <Dialog
        open={renaming}
        onClose={() => (setRenaming(false), setError(null))}
        title="Rename campaign"
        size="sm"
        dismissible={!pending}
        error={renaming ? error : null}
        onSubmit={() => name.trim() && !pending && run(() => updateCampaignAction(campaign.id, { name }), () => setRenaming(false))}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setRenaming(false), setError(null))} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} disabled={pending || !name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Campaign name" autoFocus />
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onCancel={() => (setDeleting(false), setError(null))}
        onConfirm={() =>
          run(
            () => deleteCampaignAction(campaign.id),
            () => {
              setDeleting(false);
              router.push("/ppc-keyword-tool");
            },
          )
        }
        title="Delete this campaign?"
        description={`“${campaign.name}”, its ad groups, keywords and negatives will be removed. This cannot be undone. Export the campaign first if you may need it again.`}
        confirmLabel="Delete campaign"
        busy={pending}
        error={deleting ? error : null}
      />
    </div>
  );
}

function GroupsOverview({ detail }: { detail: CampaignDetail }) {
  const ctr = detail.campaign.ctr;
  const rows = detail.groups.map((g) => ({ g, ...groupTotals(g.keywords, ctr), negatives: g.negatives.length }));
  type R = (typeof rows)[number];
  const base = `/ppc-keyword-tool?campaign=${detail.campaign.id}`;
  const columns: Column<R>[] = [
    { key: "name", header: "Ad group", sortValue: (r) => r.g.name, render: (r) => <Link href={`${base}&group=${r.g.id}`} className="font-medium text-link hover:underline">{r.g.name}</Link>, csv: (r) => r.g.name },
    { key: "keywords", header: "Keywords", align: "right" },
    { key: "volume", header: "Volume", align: "right", render: (r) => compact(r.volume) },
    { key: "avgCpc", header: "Avg. CPC", align: "right", render: (r) => (r.avgCpc == null ? na : money(r.avgCpc)), csv: (r) => (r.avgCpc == null ? "" : r.avgCpc.toFixed(2)) },
    { key: "clicks", header: "Est. clicks", align: "right", render: (r) => compact(r.clicks) },
    { key: "cost", header: "Est. cost", align: "right", render: (r) => money(r.cost) },
    { key: "negatives", header: "Negatives", align: "right" },
  ];
  return (
    <div className="rounded-lg border border-border bg-surface pt-3.5 shadow-card">
      <div className="px-4 pb-3">
        <h2 className="text-[14px] font-semibold">All ad groups</h2>
        <p className="text-[12.5px] text-text-3">Totals per ad group with the campaign CTR of {(ctr * 100).toFixed(1)}%.</p>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.g.id} defaultSort={{ key: "cost", dir: "desc" }} exportName={`${detail.campaign.name.replace(/\s+/g, "-")}_ad-groups`} emptyText="No ad groups yet." />
    </div>
  );
}

function GroupPanel({ group, detail }: { group: PpcGroup; detail: CampaignDetail }) {
  const router = useRouter();
  const { campaign } = detail;
  const { run, pending, error, notice, setError } = useRun();
  const [text, setText] = useState("");
  const [match, setMatch] = useState<AdMatch>("phrase");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [moveTo, setMoveTo] = useState<string>("");
  const parsed = useMemo(() => parseKeywordInput(text, 1000), [text]);
  const t = groupTotals(group.keywords, campaign.ctr);
  const others = detail.groups.filter((g) => g.id !== group.id);

  const columns = useMemo<Column<PpcKeyword>[]>(
    () => [
      { key: "keyword", header: "Keyword", sortValue: (r) => r.keyword, render: (r) => <KeywordLink keyword={r.keyword} db={campaign.db} className="whitespace-nowrap" />, csv: (r) => r.keyword },
      {
        key: "match",
        header: "Match type",
        sortValue: (r) => r.match,
        render: (r) => <MatchSelect value={r.match} onChange={(m) => run(() => updateKeywordsAction(campaign.id, [r.id], { match: m }))} />,
        csv: (r) => r.match,
      },
      { key: "formatted", header: "As entered in Ads", sortable: false, render: (r) => <code className="text-[12px] whitespace-nowrap text-text-2">{fmtKw(r.keyword, r.match)}</code>, csv: (r) => fmtKw(r.keyword, r.match) },
      { key: "volume", header: "Volume", align: "right", sortValue: (r) => r.volume, render: (r) => (r.volume == null ? na : r.volume.toLocaleString()) },
      { key: "cpc", header: "CPC", align: "right", sortValue: (r) => r.cpc, render: (r) => (r.cpc == null ? na : money(r.cpc)) },
      { key: "competition", header: "Com.", align: "right", sortValue: (r) => r.competition, render: (r) => (r.competition == null ? na : r.competition.toFixed(2)) },
      { key: "clicks", header: "Est. clicks", align: "right", sortValue: (r) => estimate(r, campaign.ctr).clicks, render: (r) => compact(estimate(r, campaign.ctr).clicks), csv: (r) => { const c = estimate(r, campaign.ctr).clicks; return c == null ? "" : Math.round(c); } },
      { key: "cost", header: "Est. cost", align: "right", sortValue: (r) => estimate(r, campaign.ctr).cost, render: (r) => money(estimate(r, campaign.ctr).cost), csv: (r) => { const c = estimate(r, campaign.ctr).cost; return c == null ? "" : c.toFixed(2); } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign.id, campaign.ctr, campaign.db],
  );

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.keywords.length) return;
    run(() => addKeywordsAction(campaign.id, group.id, parsed.keywords, match), (r) => {
      setText("");
      return `${r.added} keyword${r.added === 1 ? "" : "s"} added${r.skipped ? `, ${r.skipped} already in this group` : ""}.`;
    });
  };

  return (
    <>
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-3">
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium tracking-wide text-text-3 uppercase">Ad group</div>
            <h2 className="truncate text-[16px] font-semibold text-text">{group.name}</h2>
            <p className="mt-0.5 text-[12.5px] text-text-2">
              {t.keywords} keywords · {compact(t.volume)} volume · avg. CPC {t.avgCpc == null ? "n/a" : money(t.avgCpc)} · <span className="font-medium text-text">{compact(t.clicks)} clicks</span> · <span className="font-medium text-text">{money(t.cost)}</span> / month
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => (setName(group.name), setRenaming(true))}>
              <Pencil className="h-3.5 w-3.5" /> Rename
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => deleteGroupAction(campaign.id, group.id), () => router.push(`/ppc-keyword-tool?campaign=${campaign.id}&group=all`))}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
        {error && !renaming && <Callout tone="critical" className="mx-4 mb-3">{error}</Callout>}
        {notice && <Callout tone="good" className="mx-4 mb-3">{notice}</Callout>}
        <form onSubmit={add} className="flex flex-col gap-2 border-t border-border bg-surface-2 px-4 py-3 sm:flex-row sm:items-start">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add keywords to this ad group, one per line or comma separated" className="min-h-0 flex-1" aria-label="Keywords to add" />
          <div className="flex items-center gap-2">
            <MatchSelect value={match} onChange={setMatch} />
            <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!parsed.keywords.length}>
              <Plus className="h-3.5 w-3.5" /> Add{parsed.keywords.length ? ` ${parsed.keywords.length}` : ""}
            </Button>
          </div>
        </form>
        <DataTable
          className="pt-3"
          rows={group.keywords}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "volume", dir: "desc" }}
          pageSize={25}
          searchable
          searchText={(r) => r.keyword}
          selectable
          exportName={`${campaign.name.replace(/\s+/g, "-")}_${group.name.replace(/\s+/g, "-")}`}
          emptyText="No keywords in this ad group yet."
          selectionActions={(sel, clear) => (
            <>
              <Menu
                align="right"
                trigger={() => (
                  <Button size="sm" variant="ghost">
                    Match type
                  </Button>
                )}
              >
                {(close) =>
                  AD_MATCHES.map((m) => (
                    <MenuItem
                      key={m.id}
                      onClick={() => {
                        close();
                        run(() => updateKeywordsAction(campaign.id, sel.map((r) => r.id), { match: m.id }));
                        clear();
                      }}
                    >
                      Set to {m.label} <span className="text-text-3">{m.example("kw")}</span>
                    </MenuItem>
                  ))
                }
              </Menu>
              {others.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-7 w-36 text-[12px]" aria-label="Move to ad group">
                    <option value="">Move to…</option>
                    {others.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={!moveTo}
                    onClick={() => {
                      run(() => updateKeywordsAction(campaign.id, sel.map((r) => r.id), { groupId: moveTo }));
                      setMoveTo("");
                      clear();
                    }}
                  >
                    Move
                  </Button>
                </span>
              )}
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  run(() => removeKeywordsAction(campaign.id, sel.map((r) => r.id)));
                  clear();
                }}
              >
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
            </>
          )}
        />
      </div>
      <NegativesCard title="Ad group negative keywords" description="Searches that must not trigger this ad group. Cross-group negatives are added automatically." campaignId={campaign.id} groupId={group.id} negatives={group.negatives} />
      <Dialog
        open={renaming}
        onClose={() => (setRenaming(false), setError(null))}
        title="Rename ad group"
        size="sm"
        dismissible={!pending}
        error={renaming ? error : null}
        onSubmit={() => name.trim() && !pending && run(() => renameGroupAction(campaign.id, group.id, name), () => setRenaming(false))}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setRenaming(false), setError(null))} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} disabled={pending || !name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Ad group name" autoFocus />
      </Dialog>
    </>
  );
}

function NegativesCard({ title, description, campaignId, groupId, negatives }: { title: string; description: string; campaignId: string; groupId: string | null; negatives: PpcNegative[] }) {
  const { run, pending, error } = useRun();
  const [text, setText] = useState("");
  const [match, setMatch] = useState<AdMatch>("phrase");
  const parsed = parseKeywordInput(text, 1000);
  const auto = negatives.filter((n) => n.origin === "cross-group").length;
  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5 pb-2">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <p className="text-[12.5px] text-text-3">{description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge>{negatives.length} total</Badge>
          {auto > 0 && <Badge tone="info">{auto} cross-group</Badge>}
          {negatives.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => run(() => removeNegativesAction(campaignId, negatives.map((n) => n.id)))}>
              Clear all
            </Button>
          )}
        </div>
      </div>
      <div className="px-4 pb-4">
        {error && <Callout tone="critical" className="mb-2">{error}</Callout>}
        <form
          className="mb-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed.keywords.length) return;
            run(() => addNegativesAction(campaignId, groupId, parsed.keywords, match), () => setText(""));
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. free, jobs, diy (comma separated)" aria-label="Negative keywords to add" className="flex-1" />
          <div className="flex gap-2">
            <MatchSelect value={match} onChange={setMatch} label="Negative match type" />
            <Button type="submit" size="sm" loading={pending} disabled={!parsed.keywords.length}>
              Add negatives
            </Button>
          </div>
        </form>
        {negatives.length ? (
          <ul className="scroll-thin flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {negatives.map((n) => (
              <li key={n.id} className={cn("inline-flex h-6 items-center gap-1 rounded-full border pr-1 pl-2.5 text-[12px]", n.origin === "cross-group" ? "border-link/30 bg-info-soft text-text" : "border-border bg-surface-2 text-text")}>
                <span className="font-mono text-[11.5px]">−{fmtKw(n.keyword, n.match)}</span>
                <button type="button" onClick={() => run(() => removeNegativesAction(campaignId, [n.id]))} className="rounded-full p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Remove negative ${n.keyword}`}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-text-3">No negative keywords yet.</p>
        )}
      </div>
    </div>
  );
}
